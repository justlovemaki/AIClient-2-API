import axios from 'axios';
import logger from '../../utils/logger.js';
import * as http from 'http';
import * as https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { MODEL_PROTOCOL_PREFIX, isRetryableNetworkError } from '../../utils/common.js';
import { getProviderModels } from '../provider-models.js';
import { configureAxiosProxy, configureTLSSidecar } from '../../utils/proxy-utils.js';
import { MODEL_PROVIDER } from '../../utils/common.js';
import { ConverterFactory } from '../../converters/ConverterFactory.js';
import * as readline from 'readline';
import { getProviderPoolManager } from '../../services/service-manager.js';

// Chrome 136 TLS cipher suites
const CHROME_CIPHERS = [
    'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384', 'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA', 'AES128-GCM-SHA256', 'AES256-GCM-SHA384',
    'AES128-SHA', 'AES256-SHA',
].join(':');

const CHROME_SIGALGS = [
    'ecdsa_secp256r1_sha256', 'rsa_pss_rsae_sha256', 'rsa_pkcs1_sha256',
    'ecdsa_secp384r1_sha384', 'rsa_pss_rsae_sha384', 'rsa_pkcs1_sha384',
    'rsa_pss_rsae_sha512', 'rsa_pkcs1_sha512',
].join(':');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 5, timeout: 120000 });
const httpsAgent = new https.Agent({
    keepAlive: true, maxSockets: 100, maxFreeSockets: 5, timeout: 120000,
    ciphers: CHROME_CIPHERS, sigalgs: CHROME_SIGALGS, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3',
    ALPNProtocols: ['http/1.1'], ecdhCurve: 'X25519:P-256:P-384', honorCipherOrder: false, sessionTimeout: 300,
});

const CORE_MODEL_MAPPING = {
    'grok-3': { name: 'grok-3', mode: 'MODEL_MODE_GROK_3' },
    'grok-3-mini': { name: 'grok-3', mode: 'MODEL_MODE_GROK_3_MINI_THINKING' },
    'grok-3-thinking': { name: 'grok-3', mode: 'MODEL_MODE_GROK_3_THINKING' },
    'grok-4': { name: 'grok-4', mode: 'MODEL_MODE_GROK_4' },
    'grok-4-mini': { name: 'grok-4-mini', mode: 'MODEL_MODE_GROK_4_MINI_THINKING' },
    'grok-4-thinking': { name: 'grok-4', mode: 'MODEL_MODE_GROK_4_THINKING' },
    'grok-4-heavy': { name: 'grok-4', mode: 'MODEL_MODE_HEAVY' },
    'grok-4.1-mini': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_GROK_4_1_MINI_THINKING' },
    'grok-4.1-fast': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_FAST' },
    'grok-4.1-expert': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_EXPERT' },
    'grok-4.1-thinking': { name: 'grok-4-1-thinking-1129', mode: 'MODEL_MODE_GROK_4_1_THINKING' },
    'grok-4.20-beta': { name: 'grok-420', mode: 'MODEL_MODE_EXPERT', modeId: 'expert' },
    'grok-4.20-fast': { name: 'grok-420', mode: 'MODEL_MODE_FAST', modeId: 'fast' },
    'grok-imagine-1.0': { name: 'grok-3', mode: 'MODEL_MODE_FAST' },
    'grok-imagine-1.0-edit': { name: 'imagine-image-edit', mode: 'MODEL_MODE_FAST' },
    'grok-imagine-1.0-video': { name: 'grok-3', mode: 'MODEL_MODE_FAST' }
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
        const status = error.response?.status;
        const errorCode = error.code;
        const errorMessage = error.message || '';
        const isNetworkError = isRetryableNetworkError(error);

        if (status === 401 || status === 403) {
            error.shouldSwitchCredential = true;
            error.message = 'Grok authentication failed (SSO token invalid or expired)';
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
        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/app-chat/accept-tos`, headers: this.buildHeaders(), data: {}, httpAgent, httpsAgent, timeout: 15000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try { await axios(axiosConfig); } catch (e) { logger.debug(`[Grok TOS] ${e.message}`); }
    }

    async setBirthDate() {
        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/app-chat/set-birth-date`, headers: this.buildHeaders(), data: { "birthDate": "1990-01-01" }, httpAgent, httpsAgent, timeout: 15000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try { await axios(axiosConfig); } catch (e) { logger.debug(`[Grok Birth] ${e.message}`); }
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

        const axiosConfig = { 
            method: 'post', 
            url: `${this.baseUrl}/auth_mgmt.AuthManagement/UpdateUserFeatureControls`, 
            headers, 
            data: payload, 
            httpAgent, 
            httpsAgent, 
            timeout: 15000,
            responseType: 'arraybuffer' 
        };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try { await axios(axiosConfig); } catch (e) { throw e; }
    }

    _applySidecar(axiosConfig) {
        return configureTLSSidecar(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
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
        } catch (error) { 
            return Promise.reject(error); 
        }
    }

    async getUsageLimits() {
        const headers = this.buildHeaders();
        const payload = { "requestKind": "DEFAULT", "modelName": "grok-3" };
        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/rate-limits`, headers, data: payload, httpAgent, httpsAgent, timeout: 30000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try {
            const response = await axios(axiosConfig);
            const data = response.data;
            let remaining = data.remainingTokens !== undefined ? data.remainingTokens : (data.remainingQueries !== undefined ? data.remainingQueries : data.totalQueries);
            if (data.totalQueries > 0) {
                data.totalLimit = data.totalQueries;
                data.usedQueries = Math.max(0, data.totalQueries - (data.remainingQueries || 0));
                data.unit = 'queries';
            } else {
                data.totalLimit = data.totalTokens || 0;
                data.usedQueries = Math.max(0, (data.totalTokens || 0) - (data.remainingTokens || 0));
                data.unit = 'tokens';
            }
            this.lastSyncAt = Date.now();
            this.config.usageData = data;
            this.config.lastHealthCheckTime = new Date().toISOString();
            return { lastUpdated: this.lastSyncAt, remaining, ...data };
        } catch (error) { throw error; }
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
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'user-agent': this.userAgent,
            'x-statsig-id': this.genStatsigId(),
            'x-xai-request-id': uuidv4()
        };
    }

    _extractPostId(text) {
        if (!text || typeof text !== 'string') return null;
        const match = text.match(/\/post\/([0-9a-fA-F-]{32,36})/) || 
                      text.match(/\/generated\/([0-9a-fA-F-]{32,36})\//) || 
                      text.match(/\/([0-9a-fA-F-]{32,36})\/generated_video/);
        return match ? match[1] : null;
    }

    async createPost(mediaType, mediaUrl = null, prompt = null) {
        const headers = this.buildHeaders();
        headers['referer'] = `${this.baseUrl}/imagine`;
        
        // 严格遵循成功示例的载荷结构
        const payload = { mediaType };
        if (prompt && prompt.trim()) payload.prompt = prompt;
        if (mediaUrl && mediaUrl.trim()) payload.mediaUrl = mediaUrl;

        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/media/post/create`, headers, data: payload, httpAgent, httpsAgent, timeout: 30000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try {
            const response = await axios(axiosConfig);
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
        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/media/video/upscale`, headers: this.buildHeaders(), data: { videoId }, httpAgent, httpsAgent, timeout: 30000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try {
            const response = await axios(axiosConfig);
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
        const axiosConfig = {
            method: 'post',
            url: `${this.baseUrl}/rest/media/post/create-link`,
            headers,
            data: payload,
            httpAgent,
            httpsAgent,
            timeout: 15000
        };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try {
            const response = await axios(axiosConfig);
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

    buildPayload(modelId, requestBody) {
        if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, 'tools')) {
            delete requestBody.tools;
        }

        const rawModelId = typeof modelId === 'string' ? modelId : '';
        const normalizedModelId = normalizeGrokModelId(rawModelId);
        const mapping = MODEL_MAPPING[normalizedModelId] || MODEL_MAPPING['grok-3'];
        let message = requestBody.message || "";
        let toolOverrides = requestBody.toolOverrides || {};
        let fileAttachments = requestBody.fileAttachments || [];
        let modelConfigOverride = requestBody.responseMetadata?.modelConfigOverride || {};

        if (requestBody.messages && Array.isArray(requestBody.messages)) {
            let processedMessages = requestBody.messages;
            if (requestBody.tools?.length > 0) processedMessages = this.converter.formatToolHistory(requestBody.messages);
            const toolPrompt = this.converter.buildToolPrompt(requestBody.tools, requestBody.tool_choice);
            if (requestBody.tools && Object.keys(toolOverrides).length === 0) toolOverrides = this.converter.buildToolOverrides(requestBody.tools);

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
            message = texts.join("\n\n");
            if (toolPrompt) message = `${toolPrompt}\n\n${message}`;
            if (!message.trim() && (imageAttachments.length || localFileAttachments.length)) message = "Refer to the following content:";
            requestBody._extractedImages = imageAttachments;
            requestBody._extractedFiles = localFileAttachments;
        }

        if (requestBody.videoGenModelConfig) {
            modelConfigOverride.modelMap = { videoGenModelConfig: requestBody.videoGenModelConfig };
            toolOverrides.videoGen = true;
            if (requestBody.videoGenPrompt) message = requestBody.videoGenPrompt;
        }

        const modelLower = normalizedModelId.toLowerCase();
        const isMediaModel = modelLower.includes('imagine') || modelLower.includes('video') || modelLower.includes('edit');
        const isNsfw = isGrokNsfwModel(rawModelId) || requestBody.nsfw === true || requestBody.disableNsfwFilter === true;

        const payload = {
            "deviceEnvInfo": { "darkModeEnabled": false, "devicePixelRatio": 2, "screenWidth": 2056, "screenHeight": 1329, "viewportWidth": 2056, "viewportHeight": 1083 },
            "disableMemory": false, "disableNsfwFilter": isNsfw, "disableSearch": false, "disableSelfHarmShortCircuit": false, "disableTextFollowUps": false,
            "enableImageGeneration": isMediaModel, "enableImageStreaming": isMediaModel, "enableSideBySide": true,
            "fileAttachments": fileAttachments, "forceConcise": false, "forceSideBySide": false, "imageAttachments": [], "imageGenerationCount": 2,
            "isAsyncChat": false, "isReasoning": false, "message": message, "modelMode": mapping.mode, "modelName": mapping.name,
            "responseMetadata": { "requestModelDetails": { "modelId": mapping.name }, "modelConfigOverride": modelConfigOverride },
            "returnImageBytes": false, "returnRawGrokInXaiRequest": false, "sendFinalMetadata": true, "temporary": requestBody?.extra_body?.temporary ?? true, "toolOverrides": toolOverrides,
        };

        if (mapping.name === 'grok-420') {
            payload.responseMetadata = {};
            delete payload.modelName;
            delete payload.modelMode;
            payload.modeId = mapping.modeId || 'expert';
            payload.enable420 = true;
        }

        if (isMediaModel && !modelLower.includes('video')) {
            payload.enable_nsfw = isNsfw;
            if (requestBody.aspect_ratio || requestBody.aspectRatio) {
                payload.aspect_ratio = requestBody.aspect_ratio || requestBody.aspectRatio;
            }
        }

        return payload;
    }

    async generateContent(model, requestBody) {
        logger.info(`[Grok] Starting generateContent (unified processing)`);
        const stream = this.generateContentStream(model, requestBody);
        const collected = { message: "", responseId: "", postId: "", llmInfo: {}, rolloutId: "", modelResponse: null, cardAttachment: null, streamingImageGenerationResponse: null, streamingVideoGenerationResponse: null, finalVideoUrl: null, finalThumbnailUrl: null };
        
        for await (const chunk of stream) {
            const resp = chunk.result?.response;
            if (!resp) continue;
            if (resp.token) collected.message += resp.token;
            if (resp.responseId) collected.responseId = resp.responseId;
            if (resp.llmInfo) Object.assign(collected.llmInfo, resp.llmInfo);
            if (resp.rolloutId) collected.rolloutId = resp.rolloutId;
            if (resp._requestBaseUrl) collected._requestBaseUrl = resp._requestBaseUrl;
            if (resp._uuid) collected._uuid = resp._uuid;
            if (resp.modelResponse) collected.modelResponse = resp.modelResponse;
            if (resp.cardAttachment) collected.cardAttachment = resp.cardAttachment;
            if (resp.streamingImageGenerationResponse) {
                collected.streamingImageGenerationResponse = resp.streamingImageGenerationResponse;
            }
            if (resp.streamingVideoGenerationResponse) {
                collected.streamingVideoGenerationResponse = resp.streamingVideoGenerationResponse;
                if (resp.streamingVideoGenerationResponse.postId) collected.postId = resp.streamingVideoGenerationResponse.postId;
                if (resp.streamingVideoGenerationResponse.progress === 100 && resp.streamingVideoGenerationResponse.videoUrl) {
                    collected.finalVideoUrl = resp.streamingVideoGenerationResponse.videoUrl;
                    collected.finalThumbnailUrl = resp.streamingVideoGenerationResponse.thumbnailImageUrl;
                }
            }
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

        return collected;
    }

    async uploadFile(fileInput) {
        let b64 = "", mime = "application/octet-stream";
        if (fileInput.startsWith("data:")) {
            const match = fileInput.match(/^data:([^;]+);base64,(.*)$/);
            if (match) { mime = match[1]; b64 = match[2]; }
        }
        if (!b64) return null;
        const axiosConfig = { method: 'post', url: `${this.baseUrl}/rest/app-chat/upload-file`, headers: this.buildHeaders(), data: { fileName: `file.${mime.split("/")[1] || "bin"}`, fileMimeType: mime, content: b64 }, httpAgent, httpsAgent, timeout: 30000 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);
        try { return (await axios(axiosConfig)).data; } catch (error) { return null; }
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
            getProviderPoolManager().markProviderNeedRefresh(MODEL_PROVIDER.GROK_CUSTOM, { uuid: this.uuid });
        }

        const rawModel = typeof model === 'string' ? model : '';
        const normalizedModel = normalizeGrokModelId(rawModel);
        const modelLower = normalizedModel.toLowerCase();
        const isNsfw = isGrokNsfwModel(rawModel) || requestBody.nsfw === true || requestBody.disableNsfwFilter === true;
        if (isNsfw) await this.setupNsfw();

        this.buildPayload(model, requestBody);

        const isVideoModel = modelLower.includes('video');
        const isImageModel = modelLower.includes('imagine') && !isVideoModel && !modelLower.includes('edit');
        const isImageEditModel = modelLower.includes('edit');

        if (isVideoModel) {
            const videoConfig = requestBody.videoGenModelConfig || {};
            const aspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio || videoConfig.aspectRatio || "3:2";
            const videoLength = parseInt(requestBody.video_length || requestBody.videoLength || videoConfig.videoLength || 6);
            const resolutionName = requestBody.resolution_name || requestBody.resolution || videoConfig.resolutionName || "480p";
            const preset = requestBody.preset || "normal";
            let parentPostId = videoConfig.parentPostId;

            if (!parentPostId) {
                // 修复：从 requestBody.message 或 messages 数组中提取 prompt
                let prompt = requestBody.videoGenPrompt || requestBody.message;
                if (!prompt && requestBody.messages?.length > 0) {
                    const lastMsg = requestBody.messages[requestBody.messages.length - 1];
                    if (typeof lastMsg.content === 'string') {
                        prompt = lastMsg.content;
                    } else if (Array.isArray(lastMsg.content)) {
                        const textPart = lastMsg.content.find(p => p.type === 'text');
                        if (textPart) prompt = textPart.text;
                    }
                }
                prompt = prompt || "";

                let lastMsgImages = [];
                if (requestBody.messages?.length > 0) {
                    const lastMsg = requestBody.messages[requestBody.messages.length - 1];
                    if (lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
                        lastMsg.content.forEach(item => { if (item.type === 'image_url' && item.image_url?.url) lastMsgImages.push(item.image_url.url); });
                    }
                }
                if (lastMsgImages.length > 0) {
                    let mediaUrl = lastMsgImages[0];
                    if (mediaUrl.startsWith('data:') || !mediaUrl.startsWith('http')) {
                        const up = await this.uploadFile(mediaUrl);
                        if (up?.fileUri) mediaUrl = `https://assets.grok.com/${up.fileUri}`;
                    }
                    parentPostId = await this.createPost("MEDIA_POST_TYPE_VIDEO", mediaUrl);
                } else {
                    parentPostId = await this.createPost("MEDIA_POST_TYPE_VIDEO", null, prompt);
                }
            }

            if (parentPostId) {
                requestBody.videoGenModelConfig = { aspectRatio, parentPostId, resolutionName, videoLength };
                const modeMap = { "fun": "--mode=extremely-crazy", "normal": "--mode=normal", "spicy": "--mode=extremely-spicy-or-crazy" };
                requestBody.videoGenPrompt = `${requestBody.videoGenPrompt || requestBody.message || ""} ${modeMap[preset] || "--mode=custom"}`;
                requestBody.toolOverrides = { ...requestBody.toolOverrides, videoGen: true };
            }
        } else if (isImageModel || isImageEditModel) {
            requestBody.toolOverrides = { ...requestBody.toolOverrides, imageGen: true };
        }

        let fileAttachments = requestBody.fileAttachments || [];
        const toUpload = [...(requestBody._extractedImages || []), ...(requestBody._extractedFiles || [])];
        if (toUpload.length > 0) {
            for (const data of toUpload) {
                const res = await this.uploadFile(data);
                if (res?.fileMetadataId) fileAttachments.push(res.fileMetadataId);
            }
            requestBody.fileAttachments = fileAttachments;
        }

        const payload = this.buildPayload(model, requestBody);
        const axiosConfig = { method: 'post', url: this.chatApi, headers: this.buildHeaders(), data: payload, responseType: 'stream', httpAgent, httpsAgent, timeout: 60000, maxRedirects: 0 };
        configureAxiosProxy(axiosConfig, this.config, MODEL_PROVIDER.GROK_CUSTOM);
        this._applySidecar(axiosConfig);

        try {
            const response = await axios(axiosConfig);
            const rl = readline.createInterface({ input: response.data, terminal: false });
            let lastResponseId = payload.responseMetadata?.requestModelDetails?.modelId || "final";

            for await (const line of rl) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
                if (dataStr === '[DONE]') break;
                try {
                    const json = JSON.parse(dataStr);
                    if (json.result?.response) {
                        const resp = json.result.response;
                        resp._requestBaseUrl = reqBaseUrl;
                        resp._uuid = this.uuid;
                        if (resp.responseId) lastResponseId = resp.responseId;
                        if (resp.streamingVideoGenerationResponse) {
                            const vid = resp.streamingVideoGenerationResponse;
                            if (vid.progress === 100 && vid.videoUrl && (requestBody.videoGenModelConfig?.resolutionName === "720p")) {
                                const hdUrl = await this.upscaleVideo(vid.videoUrl);
                                if (hdUrl) vid.videoUrl = hdUrl;
                            }
                        }
                    }
                    hasYieldedData = true;
                    yield json;
                } catch (e) {}
            }
            yield { result: { response: { isDone: true, responseId: lastResponseId, _requestBaseUrl: reqBaseUrl, _uuid: this.uuid } } };
        } catch (error) {
            const { status, errorCode, errorMessage, isNetworkError } = this.classifyApiError(error);
            const canRetryInRequest = !hasYieldedData && retryCount < maxRetries;

            if (status === 429 && canRetryInRequest) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Grok API] Received 429 during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.generateContentStream(model, requestBody, retryCount + 1);
                return;
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
