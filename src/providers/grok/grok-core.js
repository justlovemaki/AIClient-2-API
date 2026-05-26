import axios from 'axios';
import logger from '../../utils/logger.js';
import * as http from 'http';
import * as https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, isRetryableNetworkError, getRetryAfterMs } from '../../utils/common.js';
import { configureAxiosProxy, configureTLSSidecar, isTLSSidecarEnabledForProvider } from '../../utils/proxy-utils.js';
import { MODEL_PROVIDER } from '../../utils/common.js';
import { ConverterFactory } from '../../converters/ConverterFactory.js';
import * as readline from 'readline';
import { getProviderPoolManager } from '../../services/service-manager.js';
import { ImagineWebSocketService } from './ws-imagine.js';

const CORE_MODEL_MAPPING = {
    'grok-4.1-mini': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_GROK_4_1_MINI_THINKING', modeId: 'grok-4-1-mini' },
    'grok-4.1-thinking': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_GROK_4_1_THINKING', modeId: 'grok-4-1-thinking' },
    'grok-4.20': { name: 'grok-420', mode: 'MODEL_MODE_AUTO', modeId: 'auto' },
    'grok-4.20-auto': { name: 'grok-420', mode: 'MODEL_MODE_AUTO', modeId: 'auto' },
    'grok-4.20-fast': { name: 'grok-420', mode: 'MODEL_MODE_FAST', modeId: 'fast' },
    'grok-4.20-expert': { name: 'grok-420', mode: 'MODEL_MODE_EXPERT', modeId: 'expert' },
    'grok-4.20-heavy': { name: 'grok-420', mode: 'MODEL_MODE_HEAVY', modeId: 'heavy' },
    'grok-imagine-1.0-fast': { name: 'imagine-image', mode: 'MODEL_MODE_FAST', modeId: 'fast' },
    'grok-imagine-1.0-fast-edit': { name: 'imagine-image', mode: 'MODEL_MODE_FAST', modeId: 'fast' },
    'grok-imagine-1.0': { name: 'imagine-image', mode: 'MODEL_MODE_FAST', modeId: 'expert' },
    'grok-imagine-1.0-edit': { name: 'imagine-image', mode: 'MODEL_MODE_FAST', modeId: 'expert' },
    // 'grok-imagine-1.0-video': { name: 'grok-3', mode: 'MODEL_MODE_FAST', modeId: 'fast' }
};

const MODEL_MAPPING = { ...CORE_MODEL_MAPPING };
Object.keys(CORE_MODEL_MAPPING).forEach(key => {
    if (!key.endsWith('-nsfw')) {
        MODEL_MAPPING[`${key}-nsfw`] = CORE_MODEL_MAPPING[key];
    }
});

const GROK_MODELS = Object.keys(MODEL_MAPPING);

function isGrokNsfwModel(modelId) {
    return typeof modelId === 'string' && modelId.toLowerCase().endsWith('-nsfw');
}

function normalizeGrokModelId(modelId) {
    if (typeof modelId !== 'string') return modelId;
    return isGrokNsfwModel(modelId) ? modelId.slice(0, -5) : modelId;
}

/** 供 GrokConverter 在上游无 token 字段时用 Claude tokenizer 估算（非 Grok 官方计费） */
function attachGrokUsageEstimatePayload(collected, requestBody) {
    if (!collected || !requestBody) return;
    const promptText = requestBody.message || "";
    const toolsJson = requestBody.tools && Array.isArray(requestBody.tools) && requestBody.tools.length
        ? JSON.stringify(requestBody.tools) : "";
    const includeUsage = requestBody.stream_options?.include_usage === true;
    collected._grokUsageEstimatePayload = { promptText, toolsJson, includeUsage };
}

export class GrokApiService {
    constructor(config) {
        this.config = config;
        this.uuid = config.uuid;
        this.token = config.GROK_COOKIE_TOKEN;
        this.cfClearance = config.GROK_CF_CLEARANCE;
        this.userAgent = config.GROK_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
        this.baseUrl = config.GROK_BASE_URL || 'https://grok.com';
        this.chatApi = `${this.baseUrl}/rest/app-chat/conversations/new`;
        this.isInitialized = false;
        this.nsfwSetupDone = false;
        this.converter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.GROK);
        if (this.converter && this.uuid) this.converter.setUuid(this.uuid);
        this.lastSyncAt = null;
    }

    getMaxRequestRetries() {
        const requestMaxRetries = Number.parseInt(this.config.REQUEST_MAX_RETRIES, 10);
        if (Number.isFinite(requestMaxRetries) && requestMaxRetries > 0) {
            return requestMaxRetries;
        }

        return 3;
    }

    classifyApiError(error) {
        let status = error.response?.status;
        const errorCode = error.code;
        const errorMessage = error.message || '';
        const isNetworkError = isRetryableNetworkError(error);

        // 如果是 WS 错误，尝试从 message 中提取状态码
        if (!status && errorMessage.includes('Unexpected server response:')) {
            const match = errorMessage.match(/Unexpected server response: (\d+)/);
            if (match) status = parseInt(match[1], 10);
        }

        if (!status && errorMessage.includes('Image rate limit exceeded')) {
            status = 429;
        }

        if (status === 401 || status === 403 || status === 429 || status === 502) {
            error.shouldSwitchCredential = true;
            const messages = {
                429: 'Grok rate limit reached (429)',
                502: 'Grok bad gateway (502) - possibly account or proxy issue'
            };
            error.message = messages[status] || 'Grok authentication failed (SSO token invalid or expired)';
        } else if (isNetworkError) {
            // Network jitter or request timeout should not immediately degrade account health.
            // Let the upper retry layer switch credential without incrementing the provider error count.
            error.shouldSwitchCredential = true;
            error.skipErrorCount = true;
        }

        return { status, errorCode, errorMessage, isNetworkError };
    }

    async setupNsfw() {
        if (this.nsfwSetupDone) return;
        try {
            await this.acceptTos();
            await this.setBirthDate();
            await this.enableNsfwAccount();
            this.nsfwSetupDone = true;
            logger.info(`[Grok NSFW] Account-level NSFW setup completed for ${this.uuid}`);
        } catch (error) {
            logger.warn(`[Grok NSFW] Failed to setup account-level NSFW: ${error.message}`);
        }
    }

    async acceptTos() {
        try { 
            await this._request({ url: `${this.baseUrl}/rest/app-chat/accept-tos` }); 
        } catch (e) { 
            logger.debug(`[Grok TOS] ${e.message}`); 
        }
    }

    async setBirthDate() {
        try { 
            await this._request({ 
                url: `${this.baseUrl}/rest/app-chat/set-birth-date`, 
                data: { "birthDate": "1990-01-01" } 
            }); 
        } catch (e) { 
            logger.debug(`[Grok Birth] ${e.message}`); 
        }
    }

    async enableNsfwAccount() {
        const name = Buffer.from("always_show_nsfw_content");
        const inner = Buffer.concat([Buffer.from([0x0a, name.length]), name]);
        const protobuf = Buffer.concat([Buffer.from([0x0a, 0x02, 0x10, 0x01, 0x12, inner.length]), inner]);
        
        const header = Buffer.alloc(5);
        header.writeUInt8(0, 0);
        header.writeUInt32BE(protobuf.length, 1);
        const payload = Buffer.concat([header, protobuf]);

        const headers = this.buildHeaders();
        headers['content-type'] = 'application/grpc-web+proto';
        headers['x-grpc-web'] = '1';
        headers['x-user-agent'] = 'connect-es/2.1.1';
        headers['referer'] = `${this.baseUrl}/?_s=data`;

        try {
            await this._request({
                url: `${this.baseUrl}/auth_mgmt.AuthManagement/UpdateUserFeatureControls`,
                headers,
                data: payload,
                responseType: 'arraybuffer'
            });
        } catch (e) { throw e; }
    }

    _isPart0(url) {
        return typeof url === 'string' && url.includes('part-0');
    }

    _normalizeImageUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith('http') || url.startsWith('data:')) return url;
        return `https://assets.grok.com/${url.startsWith('/') ? url.slice(1) : url}`;
    }

    _applySidecar(axiosConfig) {
        return configureTLSSidecar(axiosConfig, this.config, this.config.MODEL_PROVIDER || MODEL_PROVIDER.GROK_WEB);
    }

    /**
     * 获取模型映射
     */
    _getModelMapping(modelId) {
        const rawModelId = typeof modelId === 'string' ? modelId : '';
        const normalizedModelId = normalizeGrokModelId(rawModelId);
        return MODEL_MAPPING[normalizedModelId] || MODEL_MAPPING['grok-4.20'] || { name: 'grok-3', modeId: 'auto' };
    }

    /**
     * 统一的 Axios 请求封装
     */
    async _request(options) {
        const {
            method = 'post',
            url,
            data = {},
            headers = this.buildHeaders(),
            timeout = 15000,
            responseType,
            ...otherOptions
        } = options;

        const axiosConfig = { 
            method, 
            url, 
            headers, 
            data, 
            timeout,
            ...otherOptions
        };
        if (responseType) axiosConfig.responseType = responseType;
        
        this._applySidecar(axiosConfig);

        return await axios(axiosConfig);
    }

    /**
     * 统一执行内部请求转换钩子
     */
    async _executeInternalRequestHook(payload, converterName) {
        if (!this.config?._monitorRequestId) return;
        try {
            const { getPluginManager } = await import('../../core/plugin-manager.js');
            const pluginManager = getPluginManager();
            if (pluginManager) {
                await pluginManager.executeHook('onInternalRequestConverted', {
                    requestId: this.config._monitorRequestId,
                    internalRequest: payload,
                    converterName
                });
            }
        } catch (e) {
            logger.error(`[Grok] Error calling onInternalRequestConverted hook (${converterName}):`, e.message);
        }
    }

    _extractMessagesAndFiles(requestBody, isVideoModel = false) {
        if (!requestBody.messages || !Array.isArray(requestBody.messages)) return;

        let processedMessages = requestBody.messages;
        if (this.converter && requestBody.tools?.length > 0) {
            processedMessages = this.converter.formatToolHistory(requestBody.messages);
        }
        
        let toolPrompt = "";
        let toolOverrides = {};
        if (this.converter && requestBody.tools) {
            toolPrompt = this.converter.buildToolPrompt(requestBody.tools, requestBody.tool_choice);
            toolOverrides = this.converter.buildToolOverrides(requestBody.tools);
        }

        const extracted = [];
        const imageAttachments = [];
        const localFileAttachments = [];

        for (const msg of processedMessages) {
            const role = msg.role || "user";
            const content = msg.content;
            const parts = [];
            if (typeof content === 'string') { if (content.trim()) parts.push(content.trim()); }
            else if (Array.isArray(content)) {
                for (const item of content) {
                    if (item.type === 'text' && item.text?.trim()) parts.push(item.text.trim());
                    else if (item.type === 'image_url' && item.image_url?.url) imageAttachments.push(item.image_url.url);
                    else if (item.type === 'file' && item.file?.file_data) localFileAttachments.push(item.file.file_data);
                }
            }
            if (role === "assistant" && parts.length === 0 && Array.isArray(msg.tool_calls)) {
                for (const call of msg.tool_calls) {
                    const fn = call.function || {};
                    parts.push(`[tool_call] ${fn.name || call.name} ${typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments)}`);
                }
            }
            if (parts.length > 0) extracted.push({ role, text: parts.join("\n") });
        }

        let lastUserIdx = -1;
        for (let i = extracted.length - 1; i >= 0; i--) { if (extracted[i].role === 'user') { lastUserIdx = i; break; } }
        const texts = extracted.map((item, i) => i === lastUserIdx ? item.text : `${item.role}: ${item.text}`);
        let message = texts.join("\n\n");
        if (toolPrompt) message = `${toolPrompt}\n\n${message}`;
        if (!message.trim() && (imageAttachments.length || localFileAttachments.length)) message = "Refer to the following content:";
        
        requestBody.message = message;
        requestBody._extractedImages = imageAttachments;
        requestBody._extractedFiles = localFileAttachments;
        if (Object.keys(toolOverrides).length > 0 && !requestBody.toolOverrides) {
            requestBody.toolOverrides = toolOverrides;
        }
    }

    async initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        // this.getUsageLimits()
        //     .catch((error) => {
        //         logger.warn('[Grok] Initial usage sync failed:', error.message);
        //     });
    }

    async refreshToken() {
        try {
            // await this.getUsageLimits(); return Promise.resolve();
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                poolManager.resetProviderRefreshStatus(this.config.MODEL_PROVIDER || MODEL_PROVIDER.GROK_WEB, this.uuid);
            }
            return true;
        } catch (error) {
            logger.error('[Grok] Failed to initialize authentication:', error);
            throw new Error(`Failed to refreshToken.`);
        }
    }

    /**
     * 获取使用限制信息（返回 API 原始数据）
     */
    async getUsageLimits() {
        try {
            const response = await this._request({
                url: `${this.baseUrl}/rest/rate-limits`,
                data: { "requestKind": "DEFAULT", "modelName": "fast" },
                timeout: 30000
            });
            
            this.lastSyncAt = Date.now();
            this.config.lastHealthCheckTime = new Date().toISOString();
            
            return response.data;
        } catch (error) {
            throw error;
        }
    }

    isExpiryDateNear() {
        if (!this.lastSyncAt) return true;
        return (Date.now() - this.lastSyncAt) > (this.config.CRON_NEAR_MINUTES || 15) * 60 * 1000;
    }

    genStatsigId() {
        const randomString = (len, alpha = false) => {
            const chars = alpha ? 'abcdefghijklmnopqrstuvwxyz0123456789' : 'abcdefghijklmnopqrstuvwxyz';
            let res = '';
            for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
            return res;
        };
        const msg = Math.random() < 0.5 ? `e:TypeError: Cannot read properties of null (reading 'children['${randomString(5, true)}']')` : `e:TypeError: Cannot read properties of undefined (reading '${randomString(10)}')`;
        return Buffer.from(msg).toString('base64');
    }

    buildHeaders() {
        let ssoToken = this.token || "";
        if (ssoToken.startsWith("sso=")) ssoToken = ssoToken.substring(4);
        const cookie = ssoToken ? [`sso=${ssoToken}`, `sso-rw=${ssoToken}`] : [];
        if (this.cfClearance) cookie.push(`cf_clearance=${this.cfClearance}`);
        return {
            'accept': '*/*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
            'content-type': 'application/json',
            'cookie': cookie.join('; '),
            'origin': this.baseUrl,
            'priority': 'u=1, i',
            'referer': `${this.baseUrl}/`,
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-arch': '"x86"',
            'sec-ch-ua-bitness': '"64"',
            'sec-ch-ua-full-version': '"143.0.7499.110"',
            'sec-ch-ua-full-version-list': '"Google Chrome";v="143.0.7499.110", "Chromium";v="143.0.7499.110", "Not A(Brand";v="24.0.0.0"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-model': '""',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua-platform-version': '"19.0.0"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': this.userAgent,
            'x-statsig-id': this.genStatsigId(),
            'x-xai-request-id': uuidv4()
        };
    }

    /**
     * 视频生成专属请求头
     */
    buildVideoHeaders() {
        const headers = this.buildHeaders();
        const traceId = uuidv4().replace(/-/g, '');
        const parentId = uuidv4().replace(/-/g, '').substring(0, 16);

        Object.assign(headers, {
            'baggage': `sentry-environment=production,sentry-release=19b21d09e8a9dd440b9caae1bc973b88d50a73a6,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${traceId},sentry-org_id=4508179396558848,sentry-transaction=%2Fc%2F%3Aslug*%3F,sentry-sampled=false`,
            'referer': `${this.baseUrl}/imagine`,
            'sentry-trace': `${traceId}-${parentId}-0`,
            'traceparent': `00-${traceId}-${parentId}-00`
        });

        return headers;
    }

    _extractPostId(text) {
        if (!text || typeof text !== 'string') return null;
        const match = text.match(/\/post\/([0-9a-fA-F-]{32,36})/) || 
                      text.match(/\/generated\/([0-9a-fA-F-]{32,36})\//) || 
                      text.match(/\/([0-9a-fA-F-]{32,36})\/generated_video/) ||
                      text.match(/\/images\/([0-9a-fA-F-]{32,36})\./); // 提取 imagine-public 图片 ID
        return match ? match[1] : null;
    }

    async createPost(mediaType, mediaUrl = null, prompt = null) {
        const headers = this.buildHeaders();
        headers['referer'] = `${this.baseUrl}/imagine`;
        
        // 严格遵循成功示例的载荷结构
        const payload = { mediaType };
        if (prompt && prompt.trim()) payload.prompt = prompt;
        if (mediaUrl && mediaUrl.trim()) payload.mediaUrl = mediaUrl;

        try {
            const response = await this._request({
                url: `${this.baseUrl}/rest/media/post/create`,
                headers,
                data: payload,
                timeout: 30000
            });
            const postId = response.data?.post?.id;
            if (postId) logger.info(`[Grok Post] Media post created: ${postId} (type=${mediaType})`);
            return postId;
        } catch (error) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            logger.error(`[Grok Post] Failed to create media post: ${detail}`);
            return null;
        }
    }

    async upscaleVideo(videoUrl) {
        if (!videoUrl) return videoUrl;
        const idMatch = videoUrl.match(/\/generated\/([0-9a-fA-F-]{32,36})\//) || videoUrl.match(/\/([0-9a-fA-F-]{32,36})\/generated_video/);
        if (!idMatch) return videoUrl;
        const videoId = idMatch[1];
        
        try {
            const response = await this._request({
                url: `${this.baseUrl}/rest/media/video/upscale`,
                data: { videoId },
                timeout: 30000
            });
            return response.data?.hdMediaUrl || videoUrl;
        } catch (error) { return videoUrl; }
    }

    async createVideoShareLink(postId) {
        logger.info(`[Grok Video Link] Entering createVideoShareLink with postId: ${postId}`);
        if (!postId) return null;
        const headers = this.buildHeaders();
        headers['referer'] = `${this.baseUrl}/imagine/post/${postId}`;
        const payload = {
            "postId": postId,
            "source": "post-page",
            "platform": "web"
        };
        
        try {
            const response = await this._request({
                url: `${this.baseUrl}/rest/media/post/create-link`,
                headers,
                data: payload
            });
            const shareLink = response.data?.shareLink;
            if (shareLink) {
                // 从 shareLink 中提取 ID (通常与输入的 postId 一致)
                const idMatch = shareLink.match(/\/post\/([0-9a-fA-F-]{36}|[0-9a-fA-F]{32})/);
                const resourceId = idMatch ? idMatch[1] : postId;
                
                // 构造公开的视频资源地址
                const resourceUrl = `https://imagine-public.x.ai/imagine-public/share-videos/${resourceId}.mp4?cache=1`;
                
                logger.info(`[Grok Video Link] Public resource created for post ${postId}: ${resourceUrl}`);
                return resourceUrl;
            }
            return null;
        } catch (error) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            logger.warn(`[Grok Video Link] Failed to create share link for ${postId}: ${detail}`);
            return null;
        }
    }

    async buildPayload(modelId, requestBody) {
        if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, 'tools')) {
            delete requestBody.tools;
        }

        const rawModelId = typeof modelId === 'string' ? modelId : '';
        const normalizedModelId = normalizeGrokModelId(rawModelId);
        const mapping = this._getModelMapping(normalizedModelId);
        
        const modelLower = normalizedModelId.toLowerCase();
        const isVideoModel = modelLower.includes('video');
        const isEditModel = modelLower.includes('edit');

        if (isVideoModel) {
            return await this._buildVideoPayload(requestBody);
        }

        // --- 预处理消息和文件 (如果尚未处理) ---
        if (!requestBody._extractedImages && !requestBody._extractedFiles) {
            this._extractMessagesAndFiles(requestBody, isVideoModel);
        }

        let message = requestBody.message || "";
        let toolOverrides = requestBody.toolOverrides || {};
        let fileAttachments = requestBody.fileAttachments || [];
        let responseMetadata = requestBody.responseMetadata || {};

        const isMediaModel = modelLower.includes('imagine') || isVideoModel || isEditModel;
        const isNsfw = isGrokNsfwModel(rawModelId) || requestBody.nsfw === true || requestBody.disableNsfwFilter === true;

        const shouldEnableImage = (modelLower.includes('imagine') || modelLower.includes('edit')) && !modelLower.includes('video') || 
                                 requestBody.enableImageGeneration === true;

        const imageGenerationCount = Math.min(parseInt(requestBody.n || requestBody.imageGenerationCount || (shouldEnableImage ? 2 : 0)), 2);
        const returnImageBytes = requestBody.response_format === 'b64_json' || requestBody.responseFormat === 'b64_json';

        const finalToolOverrides = {
            "gmailSearch": false,
            "googleCalendarSearch": false,
            "outlookSearch": false,
            "outlookCalendarSearch": false,
            "googleDriveSearch": false,
            // ...toolOverrides
        };

        const payload = {
            "temporary": requestBody.temporary !== undefined ? requestBody.temporary : true,
            "message": message,
            "parentResponseId": requestBody.parentResponseId || undefined,
            "disableSearch": false,
            "enableImageGeneration": shouldEnableImage,
            "imageAttachments": [],
            "returnImageBytes": returnImageBytes,
            "returnRawGrokInXaiRequest": false,
            "fileAttachments": fileAttachments,
            "enableImageStreaming": shouldEnableImage,
            "imageGenerationCount": imageGenerationCount,
            "forceConcise": false,
            "toolOverrides": finalToolOverrides,
            "enableSideBySide": true,
            "responseMetadata": responseMetadata,
            "sendFinalMetadata": true,
            "request_metadata": {},
            "disableTextFollowUps": false,
            "disableMemory": false,
            "forceSideBySide": false,
            "isAsyncChat": false,
            "disableSelfHarmShortCircuit": false,
            "collectionIds": [],
            "connectors": [],
            "searchAllConnectors": false,
            "deviceEnvInfo": { 
                "darkModeEnabled": false, 
                "devicePixelRatio": 1, 
                "screenWidth": 2560, 
                "screenHeight": 1440, 
                "viewportWidth": 1116, 
                "viewportHeight": 1271 
            }
        };

        if (mapping.modeId && mapping.name !== 'grok-3') {
            payload.modeId = mapping.modeId;
            // 对于特定的编辑/媒体模式，如果已经有了 modeId，某些情况下 modelName 可能需要调整或保持一致
        }

        if (isMediaModel && !isVideoModel && !isEditModel) {
            payload.enable_nsfw = isNsfw;
            const aspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio;
            if (aspectRatio) {
                payload.aspect_ratio = aspectRatio;
            }
        }

        // 监控钩子
        await this._executeInternalRequestHook(payload, 'grok-buildPayload');

        return payload;
    }

    /**
     * 专门构建视频生成的精简载荷
     */
    async _buildVideoPayload(requestBody) {
        const videoConfig = requestBody.videoGenModelConfig || {};
        const aspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio || videoConfig.aspectRatio || "16:9";
        const videoLength = parseInt(requestBody.video_length || requestBody.videoLength || videoConfig.videoLength || 6);
        const resolutionName = requestBody.resolution_name || requestBody.resolution || videoConfig.resolutionName || "480p";
        const preset = requestBody.preset || requestBody.mode || "custom";
        
        // 1. 提取 Prompt 和参考图片 (通过复用逻辑)
        this._extractMessagesAndFiles(requestBody, true);
        let message = requestBody.message || "";
        let referenceImageUrl = null;
        let parentPostId = videoConfig.parentPostId;

        if (requestBody.messages?.length > 0) {
            const lastMsg = requestBody.messages[requestBody.messages.length - 1];
            if (Array.isArray(lastMsg.content)) {
                const imgPart = lastMsg.content.find(p => p.type === 'image_url');
                if (imgPart) referenceImageUrl = imgPart.image_url.url;
                const textPart = lastMsg.content.find(p => p.type === 'text');
                if (textPart) message = textPart.text;
            }
        }

        // 2. 视频前置准备：创建 Post 以获取 parentPostId
        if (!parentPostId && referenceImageUrl) {
            let mediaUrl = referenceImageUrl;
            if (mediaUrl.startsWith('data:') || !mediaUrl.startsWith('http')) {
                const up = await this.uploadFile(mediaUrl);
                if (up?.fileUri) mediaUrl = `https://assets.grok.com/${up.fileUri}`;
            }
            parentPostId = this._extractPostId(mediaUrl) || await this.createPost("MEDIA_POST_TYPE_VIDEO", mediaUrl);
            referenceImageUrl = mediaUrl;
        } else if (!parentPostId && message) {
            parentPostId = await this.createPost("MEDIA_POST_TYPE_VIDEO", null, message);
        }

        // 3. 处理模式标记
        let modeFlag = "";
        if (!message.includes("--mode=")) {
            if (preset === "fun") modeFlag = "--mode=extremely-crazy";
            else if (preset === "spicy") modeFlag = "--mode=extremely-spicy-or-crazy";
            else if (preset === "custom") modeFlag = "--mode=custom";
            else modeFlag = "--mode=normal";
        }

        if (referenceImageUrl && referenceImageUrl.startsWith('http')) {
            message = `${referenceImageUrl}${modeFlag ? '  ' + modeFlag : ''}`;
        } else {
            message = `${message || "Generate video"}${modeFlag ? ' ' + modeFlag : ''}`;
        }

        // 4. 构建精简载荷
        const payload = {
            "temporary": true,
            "modelName": "grok-3",
            "message": message,
            "toolOverrides": {
                "videoGen": true
            },
            "enableSideBySide": true,
            "responseMetadata": {
                "experiments": [],
                "modelConfigOverride": {
                    "modelMap": {
                        "videoGenModelConfig": {
                            "parentPostId": parentPostId || "",
                            "aspectRatio": aspectRatio,
                            "videoLength": videoLength,
                            "resolutionName": resolutionName
                        }
                    }
                }
            }
        };

        // 5. 监控钩子
        await this._executeInternalRequestHook(payload, 'grok-buildVideoPayload');

        return payload;
    }

    async _generateAndCollect(model, requestBody) {
        const stream = this.generateContentStream(model, requestBody);
        const collected = { 
            message: "", 
            responseId: "", 
            postId: "", 
            llmInfo: {}, 
            rolloutId: "", 
            modelResponse: null, 
            cardAttachment: null,
            cardAttachments: [],
            cardMap: {}, // 存储 cardId -> {title, original} 的映射
            generatedImageUrls: [], // 存储解析出的高清图片链接
            streamingImageGenerationResponse: null, 
            streamingVideoGenerationResponse: null, 
            finalVideoUrl: null, 
            finalThumbnailUrl: null 
        };
        
        // 用于去重的集合
        const seenCardIds = new Set();
        const seenImageUrls = new Set();
        
        try {
            for await (const chunk of stream) {
                const res = chunk.result;
                if (res?.usage && typeof res.usage === 'object') {
                    if (!collected.usage) collected.usage = {};
                    Object.assign(collected.usage, res.usage);
                }
                const resp = res?.response;
                if (!resp) continue;
                if (resp.usage && typeof resp.usage === 'object') {
                    if (!collected.usage) collected.usage = {};
                    Object.assign(collected.usage, resp.usage);
                }

                // 增加原始输出日志以排查多图生成问题
                if (resp.cardAttachment || resp.streamingImageGenerationResponse || resp.modelResponse?.cardAttachmentsJson) {
                    // logger.info(`[Grok Raw Output] Response chunk: ${JSON.stringify(resp)}`);
                }

                if (resp.token && !resp.isThinking && !resp.messageStepId) collected.message += resp.token;
                if (resp.responseId) collected.responseId = resp.responseId;
                if (resp.llmInfo) Object.assign(collected.llmInfo, resp.llmInfo);
                if (resp.rolloutId) collected.rolloutId = resp.rolloutId;
                if (resp._requestBaseUrl) collected._requestBaseUrl = resp._requestBaseUrl;
                if (resp._uuid) collected._uuid = resp._uuid;
                
                if (resp.modelResponse) {
                    const mr = resp.modelResponse;
                    
                    // 提取并记录 Grok 的流错误（例如：图片生成达到限制）
                    const errors = mr.streamErrors || mr.metadata?.stream_errors;
                    if (Array.isArray(errors)) {
                        for (const err of errors) {
                            if (err.message && !collected.message.includes(err.message)) {
                                logger.warn(`[Grok Stream Error] ${err.message}`);
                                collected.message += (collected.message ? "\n" : "") + `[Grok Error] ${err.message}`;
                            }
                        }
                    }

                    if (!collected.modelResponse) {
                        collected.modelResponse = mr;
                    } else {
                        // 合并 modelResponse 中的消息
                        if (mr.message) collected.modelResponse.message = mr.message;
                        if (mr.metadata) {
                            const prev = collected.modelResponse.metadata || {};
                            const next = mr.metadata;
                            const merged = { ...prev, ...next };
                            if (prev.llm_info && next.llm_info && typeof prev.llm_info === 'object' && typeof next.llm_info === 'object') {
                                merged.llm_info = { ...prev.llm_info, ...next.llm_info };
                            }
                            collected.modelResponse.metadata = merged;
                        }
                        // 合并 cardAttachmentsJson (如果存在且未预过滤，但此处通常已由流预处理)
                        if (Array.isArray(mr.cardAttachmentsJson)) {
                            if (!collected.modelResponse.cardAttachmentsJson) collected.modelResponse.cardAttachmentsJson = [];
                            for (const raw of mr.cardAttachmentsJson) {
                                try {
                                    const parsed = JSON.parse(raw);
                                    if (parsed.id && !seenCardIds.has(parsed.id)) {
                                        collected.modelResponse.cardAttachmentsJson.push(raw);
                                        seenCardIds.add(parsed.id);
                                    }
                                } catch(e) { collected.modelResponse.cardAttachmentsJson.push(raw); }
                            }
                        }
                    }

                    // 使用 generateContentStream 预先提取出的图片信息
                    if (Array.isArray(mr.generatedImageUrls)) {
                        for (const url of mr.generatedImageUrls) {
                            if (!seenImageUrls.has(url)) {
                                collected.generatedImageUrls.push(url);
                                seenImageUrls.add(url);
                            }
                        }
                    }
                    if (mr._cardIdMap) {
                        Object.assign(collected.cardMap, mr._cardIdMap);
                    }
                }

                if (resp.cardAttachment) {
                    try {
                        const parsed = typeof resp.cardAttachment.jsonData === 'string' ? JSON.parse(resp.cardAttachment.jsonData) : resp.cardAttachment.jsonData;
                        const id = parsed?.id;
                        
                        collected.cardAttachment = resp.cardAttachment;
                        
                        if (!id || !seenCardIds.has(id)) {
                            collected.cardAttachments.push(resp.cardAttachment);
                            if (id) seenCardIds.add(id);
                        }
                        
                        // resp.cardAttachment 中的图片不再单独提取，避免重复或中间状态干扰 (已在 generateContentStream 中预处理)
                    } catch(e) {
                        collected.cardAttachment = resp.cardAttachment;
                        collected.cardAttachments.push(resp.cardAttachment);
                    }
                }

                if (resp.streamingImageGenerationResponse) {
                    collected.streamingImageGenerationResponse = resp.streamingImageGenerationResponse;
                }
                if (resp.streamingVideoGenerationResponse) {
                    collected.streamingVideoGenerationResponse = resp.streamingVideoGenerationResponse;
                    // 同时检查 videoPostId, postId 和 videoId
                    const videoId = resp.streamingVideoGenerationResponse.videoPostId || 
                                  resp.streamingVideoGenerationResponse.postId || 
                                  resp.streamingVideoGenerationResponse.videoId;
                    if (videoId) collected.postId = videoId;

                    if (resp.streamingVideoGenerationResponse.progress === 100 && resp.streamingVideoGenerationResponse.videoUrl) {
                        collected.finalVideoUrl = resp.streamingVideoGenerationResponse.videoUrl;
                        collected.finalThumbnailUrl = resp.streamingVideoGenerationResponse.thumbnailImageUrl;
                    }
                }
            }
        } catch (error) {
            // 如果已经采集到了图片或视频，则不抛出异常，而是返回已有的结果
            if (collected.cardAttachments.length > 0 || collected.generatedImageUrls.length > 0 || collected.finalVideoUrl) {
                logger.warn(`[Grok] Error during collection, but partial results exist. Returning what we have: ${error.message}`);
                attachGrokUsageEstimatePayload(collected, requestBody);
                return collected;
            }
            throw error;
        }
        attachGrokUsageEstimatePayload(collected, requestBody);
        return collected;
    }

    _mergeCollectedResults(results) {
        if (!results || results.length === 0) return null;
        const collected = results[0];
        if (results.length === 1) return collected;

        const seenCardIds = new Set();
        const seenImageUrls = new Set();

        const track = (res) => {
            if (res.cardAttachments) {
                for (const att of res.cardAttachments) {
                    try {
                        const parsed = typeof att.jsonData === 'string' ? JSON.parse(att.jsonData) : att.jsonData;
                        if (parsed?.id) seenCardIds.add(parsed.id);
                    } catch (e) {}
                }
            }
            if (res.generatedImageUrls) {
                for (const url of res.generatedImageUrls) seenImageUrls.add(url);
            }
        };

        track(collected);

        for (let i = 1; i < results.length; i++) {
            const res = results[i];
            if (res.message) collected.message += "\n" + res.message;
            
            if (res.cardAttachments) {
                for (const att of res.cardAttachments) {
                    try {
                        const parsed = typeof att.jsonData === 'string' ? JSON.parse(att.jsonData) : att.jsonData;
                        const id = parsed?.id;
                        if (!id || !seenCardIds.has(id)) {
                            collected.cardAttachments.push(att);
                            if (id) seenCardIds.add(id);
                        }
                    } catch (e) { collected.cardAttachments.push(att); }
                }
            }
            
            if (res.generatedImageUrls) {
                for (const url of res.generatedImageUrls) {
                    if (!seenImageUrls.has(url)) {
                        collected.generatedImageUrls.push(url);
                        seenImageUrls.add(url);
                    }
                }
            }

            if (res.cardMap) Object.assign(collected.cardMap, res.cardMap);

            if (res.modelResponse?.cardAttachmentsJson) {
                if (!collected.modelResponse) collected.modelResponse = { cardAttachmentsJson: [] };
                if (!collected.modelResponse.cardAttachmentsJson) collected.modelResponse.cardAttachmentsJson = [];
                for (const raw of res.modelResponse.cardAttachmentsJson) {
                    try {
                        const parsed = JSON.parse(raw);
                        const id = parsed?.id;
                        if (!id || !seenCardIds.has(id)) {
                            collected.modelResponse.cardAttachmentsJson.push(raw);
                            if (id) seenCardIds.add(id);
                        }
                    } catch (e) { collected.modelResponse.cardAttachmentsJson.push(raw); }
                }
            }
        }
        return collected;
    }

    async generateContent(model, requestBody) {
        if (requestBody._monitorRequestId) { 
            this.config._monitorRequestId = requestBody._monitorRequestId; 
            delete requestBody._monitorRequestId; 
        }
        
        logger.info(`[Grok] Starting generateContent (unified processing)`);
        
        const n = parseInt(requestBody.n || 1);
        const normalizedModel = normalizeGrokModelId(model);
        const modelLower = normalizedModel.toLowerCase();
        const isImagine = (modelLower.includes('imagine') || modelLower.includes('edit')) && !modelLower.includes('video');
        // 识别优先使用 WS 的模型 (仅限图片生成，排除视频)
        // const isWSPreferred = isImagine && !modelLower.includes('video');
        
        let collected;
        try {
            // 如果是优先 WS 的模型，尝试直接走 WS 逻辑
            /* if (isWSPreferred) {
                try {
                    return await this._generateAndCollectWS(model, requestBody);
                } catch (wsError) {
                    logger.warn(`[Grok] Initial WS generation failed, falling back to app_chat: ${wsError.message}`);
                    // 失败后继续向下走传统的 app_chat 逻辑
                }
            } */

            if (n <= 2 || !isImagine) {
                // 单次请求处理
                collected = await this._generateAndCollect(model, requestBody);
            } else {
                // 处理 n > 2 的情况，分批并发请求
                logger.info(`[Grok] Multi-image request detected (n=${n}), splitting into multiple tasks`);
                const perCall = 2;
                const callsNeeded = Math.ceil(n / perCall);
                const tasks = [];
                
                for (let i = 0; i < callsNeeded; i++) {
                    const count = Math.min(perCall, n - i * perCall);
                    const subRequestBody = { ...requestBody, n: count };
                    tasks.push(this._generateAndCollect(model, subRequestBody));
                }
                
                const results = await Promise.all(tasks);
                collected = this._mergeCollectedResults(results);
            }
        } catch (error) {
            // 只有图片生成才支持 WebSocket Fallback，排除视频模型
            if (isImagine && !modelLower.includes('video')) {
                logger.warn(`[Grok] app_chat image generation failed, trying ws_imagine fallback: ${error.message}`);
                try {
                    return await this._generateAndCollectWS(model, requestBody);
                } catch (wsError) {
                    logger.error(`[Grok] ws_imagine fallback also failed: ${wsError.message}`);
                    throw error; // 抛出原始错误
                }
            }
            throw error;
        }

        logger.info(`[Grok] Finalizing collection. model: ${model}, respId: ${collected.responseId}, videoPostId: ${collected.postId}`);
        
        // 1. 仅针对视频进行 postId 提取和分享链接创建
        const isVideo = !!(collected.finalVideoUrl || collected.streamingVideoGenerationResponse || model.toLowerCase().includes('video'));
        logger.info(`[Grok Decision] isVideo detected: ${isVideo}. (finalUrl: ${!!collected.finalVideoUrl}, streamResp: ${!!collected.streamingVideoGenerationResponse}, modelIncludeVideo: ${model.toLowerCase().includes('video')})`);
        
        if (isVideo && !collected.postId) {
            if (collected.finalVideoUrl) {
                collected.postId = this._extractPostId(collected.finalVideoUrl);
                logger.info(`[Grok Decision] PostId extracted from finalVideoUrl: ${collected.postId}`);
            }
            if (!collected.postId && collected.message) {
                collected.postId = this._extractPostId(collected.message);
                logger.info(`[Grok Decision] PostId extracted from message text: ${collected.postId}`);
            }
        }

        // 2. 仅在确实是视频且有 postId 时，处理视频分享链接 (createVideoShareLink)
        if (isVideo && collected.postId) {
            logger.info(`[Grok Decision] Calling createVideoShareLink...`);
            const shareUrl = await this.createVideoShareLink(collected.postId);
            if (shareUrl) {
                logger.info(`[Grok Video Result] ShareUrl created: ${shareUrl}. Replacing links...`);
                if (collected.finalVideoUrl) collected.finalVideoUrl = shareUrl;
                if (collected.streamingVideoGenerationResponse) collected.streamingVideoGenerationResponse.videoUrl = shareUrl;
                
                if (collected.message) {
                    const grokLinkRegex = /https?:\/\/grok\.com\/imagine\/post\/([0-9a-fA-F-]{32,36})/g;
                    collected.message = collected.message.replace(grokLinkRegex, shareUrl);
                }
            } else {
                logger.warn(`[Grok Video Result] createVideoShareLink returned NULL for ${collected.postId}`);
            }
        } else if (isVideo) {
            logger.warn(`[Grok Video Skip] isVideo is TRUE but NO postId found to create share link.`);
        }

        attachGrokUsageEstimatePayload(collected, requestBody);
        return collected;
    }

    /**
     * WebSocket 方式生成图片 (Fallback)
     */
    async _generateAndCollectWS(model, requestBody) {
        const n = parseInt(requestBody.n || 1);
        // 提取 prompt
        let prompt = requestBody.message || requestBody.videoGenPrompt;
        if (!prompt && requestBody.messages?.length > 0) {
            const lastMsg = requestBody.messages[requestBody.messages.length - 1];
            prompt = typeof lastMsg.content === 'string' ? lastMsg.content : (lastMsg.content?.find(p => p.type === 'text')?.text || "");
        }
        prompt = prompt || "A beautiful image";

        const aspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio || "1:1";
        const enableNsfw = requestBody.nsfw !== false;
        
        logger.info(`[Grok WS] Starting fallback image generation for: ${prompt.substring(0, 50)}...`);
        
        const wsService = new ImagineWebSocketService(this.config);
        const stream = wsService.stream(this.token, prompt, aspectRatio, n, enableNsfw);
        
        const collected = { 
            message: "", 
            responseId: `ws-${uuidv4()}`, 
            postId: "", 
            llmInfo: { modelHash: "ws-imagine" }, 
            rolloutId: "", 
            _uuid: this.uuid,
            _requestBaseUrl: this.config.requestBaseUrl,
            modelResponse: { cardAttachmentsJson: [] }, 
            cardAttachments: [] 
        };
        
        let imagesCollected = 0;
        const latestImages = new Map(); // 用于缓存每个 imageId 的最新状态

        const addImgToCollected = async (item) => {
            const imageUrl = item.url || ((item.blob && !item.blob.startsWith('data:')) ? `data:image/png;base64,${item.blob}` : item.blob);
            
            // 处理 imagine-public 图片：创建媒体发布（Post）以获取持久化链接
            let shareLink = null;
            if (imageUrl.includes('imagine-public.x.ai')) {
                const postId = await this.createPost('IMAGE', imageUrl, prompt);
                if (postId) {
                    shareLink = await this.createVideoShareLink(postId);
                    collected.postId = postId;
                }
            }
            
            const cardData = {
                id: item.id || item.image_id || item.job_id || uuidv4(),
                image: {
                    original: imageUrl,
                    title: "Generated Image",
                    shareLink: shareLink
                }
            };
            const jsonStr = JSON.stringify(cardData);
            collected.cardAttachments.push({ jsonData: jsonStr });
            collected.modelResponse.cardAttachmentsJson.push(jsonStr);
            imagesCollected++;
            logger.info(`[Grok WS] Collected image: ${cardData.id} (progress: ${item.percentage_complete}%)`);
        };

        for await (const item of stream) {
            // 增加 WS 原始输出日志
            if (item.type === 'image' || item.type === 'error') {
                logger.info(`[Grok WS Raw] Item: ${JSON.stringify(item)}`);
            }

            if (item.type === 'error') {
                const errorMsg = item.err_msg || item.error || 'WebSocket generation failed';
                
                // 救回逻辑：如果发生错误且没有 100% 的图，但有中间图，则使用中间图
                if (imagesCollected === 0 && latestImages.size > 0) {
                    logger.info(`[Grok WS] Salvaging ${latestImages.size} intermediate images on error.`);
                    for (const img of latestImages.values()) {
                        await addImgToCollected(img);
                    }
                }

                if (imagesCollected > 0) {
                    logger.warn(`[Grok WS] Error after collecting ${imagesCollected} images: ${errorMsg}. Returning partial results.`);
                    collected.message += (collected.message ? "\n" : "") + `[Grok Error] ${errorMsg}`;
                    break;
                }
                throw new Error(errorMsg);
            }

            if (item.type === 'image') {
                // 如果是包含 part-0 的分块图片资源，则直接过滤不处理
                if (this._isPart0(item.url)) continue;

                const imgId = item.id || item.image_id || item.job_id || uuidv4();
                latestImages.set(imgId, item);

                const hasMedia = item.url || item.blob;
                const isFinal = item.percentage_complete === 100 || item.stage === 'final';

                if (hasMedia && isFinal) {
                    await addImgToCollected(item);
                }
            }
        }
        
        // 结束循环后的救回逻辑
        if (imagesCollected === 0 && latestImages.size > 0) {
            for (const img of latestImages.values()) {
                await addImgToCollected(img);
            }
        }
        
        if (collected.cardAttachments.length === 0) {
            throw new Error("WebSocket generation returned no images");
        }

        attachGrokUsageEstimatePayload(collected, requestBody);
        return collected;
    }

    /**
     * WebSocket 方式流式生成图片 (Fallback)
     */
    async * _generateContentStreamWS(model, requestBody) {
        const n = parseInt(requestBody.n || 1);
        let prompt = requestBody.message || requestBody.videoGenPrompt;
        if (!prompt && requestBody.messages?.length > 0) {
            const lastMsg = requestBody.messages[requestBody.messages.length - 1];
            prompt = typeof lastMsg.content === 'string' ? lastMsg.content : (lastMsg.content?.find(p => p.type === 'text')?.text || "");
        }
        prompt = prompt || "A beautiful image";

        const aspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio || "1:1";
        const enableNsfw = requestBody.nsfw !== false;

        const wsService = new ImagineWebSocketService(this.config);
        const stream = wsService.stream(this.token, prompt, aspectRatio, n, enableNsfw);
        
        const responseId = `ws-${uuidv4()}`;

        let imagesYielded = 0;
        for await (const item of stream) {
            // 增加 WS 流式原始输出日志
            if (item.type === 'image' || item.type === 'error') {
                // logger.info(`[Grok WS Stream Raw] Item: ${JSON.stringify(item)}`);
            }

            if (item.type === 'error') {
                const errorMsg = item.err_msg || item.error || 'WebSocket generation failed';
                if (imagesYielded > 0) {
                    logger.warn(`[Grok WS] Error after yielding ${imagesYielded} images: ${errorMsg}. Ending stream gracefully.`);
                    yield {
                        result: {
                            response: {
                                responseId,
                                token: `\n\n[Grok Error] ${errorMsg}`
                            }
                        }
                    };
                    break;
                }
                throw new Error(errorMsg);
            }
            if (item.type === 'image') {
                // 如果是包含 part-0 的分块图片资源，则直接过滤不处理
                if (this._isPart0(item.url)) continue;

                yield {
                    result: {
                        response: {
                            responseId,
                            streamingImageGenerationResponse: {
                                imageIndex: 0,
                                progress: item.percentage_complete || (item.stage === 'final' ? 100 : (item.stage === 'medium' ? 50 : 10))
                            }
                        }
                    }
                };
                
                // 只有最终阶段且有媒体数据时，才输出图片
                const hasMedia = item.url || item.blob;
                const isFinal = item.percentage_complete === 100 || item.stage === 'final';
                
                if (hasMedia && isFinal) {
                    // 优先从 url 字段获取链接，如果不存在则使用 blob 降级
                    const imageUrl = item.url || ((item.blob && !item.blob.startsWith('data:')) ? `data:image/png;base64,${item.blob}` : item.blob);
                    
                    // 处理 imagine-public 图片：创建媒体发布（Post）以获取持久化链接
                    let shareLink = null;
                    if (imageUrl.includes('imagine-public.x.ai')) {
                        const postId = await this.createPost('IMAGE', imageUrl, prompt);
                        if (postId) {
                            shareLink = await this.createVideoShareLink(postId);
                        }
                    }

                    const cardData = {
                        id: item.id || item.image_id || uuidv4(),
                        image: {
                            original: imageUrl,
                            title: "Generated Image",
                            shareLink: shareLink
                        }
                    };
                    yield {
                        result: {
                            response: {
                                responseId,
                                cardAttachment: {
                                    jsonData: JSON.stringify(cardData)
                                }
                            }
                        }
                    };
                    imagesYielded++;
                }
            }
        }
        const doneResult = { response: { isDone: true, responseId } };
        attachGrokUsageEstimatePayload(doneResult, requestBody);
        yield { result: doneResult };
    }

    async uploadFile(fileInput) {
        let b64 = "", mime = "application/octet-stream";
        if (fileInput.startsWith("data:")) {
            const match = fileInput.match(/^data:([^;]+);base64,(.*)$/);
            if (match) { mime = match[1]; b64 = match[2]; }
        }
        if (!b64) return null;
        
        try {
            const response = await this._request({
                url: `${this.baseUrl}/rest/app-chat/upload-file`,
                data: { fileName: `file.${mime.split("/")[1] || "bin"}`, fileMimeType: mime, content: b64 },
                timeout: 30000
            });
            return response.data;
        } catch (error) { return null; }
    }

    async * generateContentStream(model, requestBody, retryCount = 0) {
        const maxRetries = this.getMaxRequestRetries();
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;
        let hasYieldedData = false;

        if (this.converter) {
            if (this.uuid) this.converter.setUuid(this.uuid);
            if (requestBody._requestBaseUrl) this.converter.setRequestBaseUrl(requestBody._requestBaseUrl);
        }

        if (requestBody._monitorRequestId) { this.config._monitorRequestId = requestBody._monitorRequestId; delete requestBody._monitorRequestId; }
        const reqBaseUrl = requestBody._requestBaseUrl;
        if (requestBody._requestBaseUrl) delete requestBody._requestBaseUrl;

        if (this.isExpiryDateNear() && getProviderPoolManager() && this.uuid) {
            getProviderPoolManager().markProviderNeedRefresh(this.config.MODEL_PROVIDER || MODEL_PROVIDER.GROK_WEB, { uuid: this.uuid });
        }

        const rawModel = typeof model === 'string' ? model : '';
        const normalizedModel = normalizeGrokModelId(rawModel);
        const modelLower = normalizedModel.toLowerCase();
        const isImagine = (modelLower.includes('imagine') || modelLower.includes('edit')) && !modelLower.includes('video');
        // 识别优先使用 WS 的模型 (仅限图片生成，排除视频)
        // const isWSPreferred = isImagine && !modelLower.includes('video');
        const isNsfw = isGrokNsfwModel(rawModel) || requestBody.nsfw === true || requestBody.disableNsfwFilter === true;
        if (isNsfw) await this.setupNsfw();

        // 提前提取图片和消息，确保上传逻辑能获取到图片
        this._extractMessagesAndFiles(requestBody, modelLower.includes('video'));

        // 如果是优先 WS 的模型，尝试直接走 WS 流逻辑
        /* if (isWSPreferred && retryCount === 0) {
            try {
                yield* this._generateContentStreamWS(model, requestBody);
                return;
            } catch (wsError) {
                logger.warn(`[Grok] Initial WS stream failed, falling back to app_chat: ${wsError.message}`);
                // 失败后继续向下执行传统的 app_chat 逻辑
            }
        } */

        let fileAttachments = requestBody.fileAttachments || [];
        const toUpload = [...(requestBody._extractedImages || []), ...(requestBody._extractedFiles || [])];
        if (toUpload.length > 0) {
            for (const data of toUpload) {
                const res = await this.uploadFile(data);
                if (res?.fileMetadataId) fileAttachments.push(res.fileMetadataId);
            }
            requestBody.fileAttachments = fileAttachments;
        }

        const payload = await this.buildPayload(model, requestBody);
        
        let url = this.chatApi;
        if (requestBody.conversationId) {
            url = `${this.baseUrl}/rest/app-chat/conversations/${requestBody.conversationId}/responses`;
        }

        const isVideo = modelLower.includes('video');
        const headers = isVideo ? this.buildVideoHeaders() : this.buildHeaders();

        try {
            const response = await this._request({
                method: 'post',
                url,
                headers,
                data: payload,
                responseType: 'stream',
                timeout: 60000,
                maxRedirects: 0
            });
            const rl = readline.createInterface({ input: response.data, terminal: false });
            const fallbackResponseId = uuidv4();
            let lastResponseId = fallbackResponseId;
            let grokStreamUsagePayloadAttached = false;

            for await (const line of rl) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
                if (dataStr === '[DONE]') break;
                try {
                    const json = JSON.parse(dataStr);
                    if (json.result?.response) {
                        if (requestBody && !grokStreamUsagePayloadAttached) {
                            attachGrokUsageEstimatePayload(json.result, requestBody);
                            grokStreamUsagePayloadAttached = true;
                        }
                        const resp = json.result.response;
                        if (!resp.responseId) {
                            resp.responseId = lastResponseId;
                        }
                        resp._requestBaseUrl = reqBaseUrl;
                        resp._uuid = this.uuid;

                        // --- 预处理与中心化过滤 ---
                        
                        // 0. 处理思考内容过滤 (根据指令：不要返回思考内容)
                        if (resp.isThinking || resp.messageStepId) {
                            // 清空 token 以抑制思考输出
                            resp.token = "";
                            // 标记为非思考，防止 converter 产生 <think> 标签或 reasoning_content
                            resp.isThinking = false;
                            delete resp.messageStepId;
                        }
                        
                        // 1. 处理 cardAttachment (根据最新指令，若是图片则不处理)
                        if (resp.cardAttachment) {
                            try {
                                const parsed = typeof resp.cardAttachment.jsonData === 'string' ? JSON.parse(resp.cardAttachment.jsonData) : resp.cardAttachment.jsonData;
                                const url = parsed?.image_chunk?.imageUrl || parsed?.image?.original;
                                if (url) {
                                    // 只要包含图片资源，直接从流中删除该卡片 (指令：resp.cardAttachment 中的图片都不处理)
                                    delete resp.cardAttachment;
                                }
                            } catch (e) {}
                        }

                        // 2. 处理 modelResponse.cardAttachmentsJson (核心图片源)
                        if (Array.isArray(resp.modelResponse?.cardAttachmentsJson)) {
                            const extractedUrls = [];
                            const cardIdMap = {};

                            resp.modelResponse.cardAttachmentsJson = resp.modelResponse.cardAttachmentsJson.filter(raw => {
                                try {
                                    const parsed = JSON.parse(raw);
                                    const url = parsed?.image_chunk?.imageUrl || parsed?.image?.original;
                                    
                                    // 过滤：如果是 part-0 分块资源，直接丢弃
                                    if (this._isPart0(url)) return false;
                                    
                                    // 提取：如果是完成的图片，记录其 URL 和 元数据
                                    if (url && (parsed.image_chunk?.progress === 100 || parsed.image?.original)) {
                                        const fullUrl = this._normalizeImageUrl(url);
                                        extractedUrls.push(fullUrl);
                                        if (parsed.id) {
                                            cardIdMap[parsed.id] = {
                                                title: parsed.image_chunk?.imageTitle || parsed.image?.title || "image",
                                                original: fullUrl
                                            };
                                        }
                                    }
                                    return true;
                                } catch (e) { return true; }
                            });
                            
                            // 将提取出的扁平化数据注入响应块，供后续 converter 和 collector 直接使用，避免二次解析
                            if (extractedUrls.length > 0) {
                                resp.modelResponse.generatedImageUrls = (resp.modelResponse.generatedImageUrls || []).concat(extractedUrls);
                                resp.modelResponse._cardIdMap = cardIdMap; // 内部临时字段
                            }
                        }

                        if (resp.responseId) lastResponseId = resp.responseId;
                        if (resp.streamingImageGenerationResponse) {
                            // 图片生成进度通过流透传，暂无额外处理
                        }
                        if (resp.streamingVideoGenerationResponse) {
                            const vid = resp.streamingVideoGenerationResponse;
                            if (vid.progress === 100 && vid.videoUrl && (requestBody.videoGenModelConfig?.resolutionName === "720p")) {
                                const hdUrl = await this.upscaleVideo(vid.videoUrl);
                                if (hdUrl) vid.videoUrl = hdUrl;
                            }
                        }
                    }
                    hasYieldedData = true;
                    if (process.env.GROK_LOG_LAST_CHUNK === '1' || /^true$/i.test(process.env.GROK_LOG_LAST_CHUNK || '')) {
                        this._grokLastStreamJsonForDebug = json;
                    }
                    yield json;
                } catch (e) {}
            }
            if ((process.env.GROK_LOG_LAST_CHUNK === '1' || /^true$/i.test(process.env.GROK_LOG_LAST_CHUNK || '')) && this._grokLastStreamJsonForDebug) {
                try {
                    const s = JSON.stringify(this._grokLastStreamJsonForDebug);
                    logger.info(`[Grok] Last SSE chunk before synthetic isDone (truncated 4000): ${s.slice(0, 4000)}`);
                } catch (err) {
                    logger.warn(`[Grok] Could not stringify last chunk: ${err.message}`);
                }
                this._grokLastStreamJsonForDebug = null;
            }
            const doneResult = { response: { isDone: true, responseId: lastResponseId, _requestBaseUrl: reqBaseUrl, _uuid: this.uuid } };
            attachGrokUsageEstimatePayload(doneResult, requestBody);
            yield { result: doneResult };
        } catch (error) {
            const { status, errorCode, errorMessage, isNetworkError } = this.classifyApiError(error);
            const canRetryInRequest = !hasYieldedData && retryCount < maxRetries;

            // 只有图片生成且未发送过数据时才尝试 WebSocket Fallback (明确排除视频)
            const isImagineImage = (modelLower.includes('imagine') || modelLower.includes('edit')) && !modelLower.includes('video');
            if (isImagineImage && !hasYieldedData && retryCount === 0) {
                logger.warn(`[Grok] app_chat stream failed, trying ws_imagine fallback: ${error.message}`);
                try {
                    yield* this._generateContentStreamWS(model, requestBody);
                    return;
                } catch (wsError) {
                    logger.error(`[Grok] ws_imagine fallback also failed: ${wsError.message}`);
                }
            }

            if (status === 429) {
                const retryAfter = getRetryAfterMs(error);
                if (retryAfter !== null) {
                    logger.warn(`[Grok API] Received 429 with Retry-After: ${retryAfter}ms during stream. Throwing to upper layer.`);
                    throw error;
                }
                if (canRetryInRequest) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    logger.info(`[Grok API] Received 429 (Too Many Requests) during stream. No Retry-After found. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    yield* this.generateContentStream(model, requestBody, retryCount + 1);
                    return;
                }
            }

            if (status >= 500 && status < 600 && canRetryInRequest) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Grok API] Received ${status} server error during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.generateContentStream(model, requestBody, retryCount + 1);
                return;
            }

            if (isNetworkError && canRetryInRequest) {
                const delay = baseDelay * Math.pow(2, retryCount);
                const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                logger.info(`[Grok API] Network error (${errorIdentifier}) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.generateContentStream(model, requestBody, retryCount + 1);
                return;
            }

            throw error;
        }
    }

    async listModels() {
        return { data: GROK_MODELS.map(id => ({ id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "xai", display_name: id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') })) };
    }
}
