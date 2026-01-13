import { OpenAIResponsesApiService } from './openai/openai-responses-core.js'; // 导入OpenAIResponsesApiService
import { GeminiApiService } from './gemini/gemini-core.js'; // 导入geminiApiService
import { AntigravityApiService } from './gemini/antigravity-core.js'; // 导入AntigravityApiService
import { OpenAIApiService } from './openai/openai-core.js'; // 导入OpenAIApiService
import { ClaudeApiService } from './claude/claude-core.js'; // 导入ClaudeApiService
import { KiroApiService } from './claude/claude-kiro.js'; // 导入KiroApiService
import { OrchidsApiService } from './claude/claude-orchids.js'; // 导入OrchidsApiService
import { QwenApiService } from './openai/qwen-core.js'; // 导入QwenApiService
import { IFlowApiService } from './openai/iflow-core.js'; // 导入IFlowApiService
import { MODEL_PROVIDER } from '../utils/common.js'; // 导入 MODEL_PROVIDER

// 定义AI服务适配器接口
// 所有的服务适配器都应该实现这些方法
export class ApiServiceAdapter {
    constructor() {
        if (new.target === ApiServiceAdapter) {
            throw new TypeError("Cannot construct ApiServiceAdapter instances directly");
        }
    }

    /**
     * 生成内容
     * @param {string} model - 模型名称
     * @param {object} requestBody - 请求体
     * @returns {Promise<object>} - API响应
     */
    async generateContent(model, requestBody) {
        throw new Error("Method 'generateContent()' must be implemented.");
    }

    /**
     * 流式生成内容
     * @param {string} model - 模型名称
     * @param {object} requestBody - 请求体
     * @returns {AsyncIterable<object>} - API响应流
     */
    async *generateContentStream(model, requestBody) {
        throw new Error("Method 'generateContentStream()' must be implemented.");
    }

    /**
     * 列出可用模型
     * @returns {Promise<object>} - 模型列表
     */
    async listModels() {
        throw new Error("Method 'listModels()' must be implemented.");
    }

    /**
     * 刷新认证令牌
     * @returns {Promise<void>}
     */
    async refreshToken() {
        throw new Error("Method 'refreshToken()' must be implemented.");
    }
}

// Gemini API 服务适配器
export class GeminiApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.geminiApiService = new GeminiApiService(config);
        // this.geminiApiService.initialize().catch(error => {
        //     console.error("Failed to initialize geminiApiService:", error);
        // });
    }

    async generateContent(model, requestBody) {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        return this.geminiApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        yield* this.geminiApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        // Gemini Core API 的 listModels 已经返回符合 Gemini 格式的数据，所以不需要额外转换
        return this.geminiApiService.listModels();
    }

    async refreshToken() {
        if(this.geminiApiService.isExpiryDateNear()===true){
            console.log(`[Gemini] Expiry date is near, refreshing token...`);
            return this.geminiApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    /**
     * 获取用量限制信息
     * @returns {Promise<Object>} 用量限制信息
     */
    async getUsageLimits() {
        if (!this.geminiApiService.isInitialized) {
            console.warn("geminiApiService not initialized, attempting to re-initialize...");
            await this.geminiApiService.initialize();
        }
        return this.geminiApiService.getUsageLimits();
    }
}

// Antigravity API 服务适配器
export class AntigravityApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.antigravityApiService = new AntigravityApiService(config);
    }

    async generateContent(model, requestBody) {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        yield* this.antigravityApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.listModels();
    }

    async refreshToken() {
        if (this.antigravityApiService.isExpiryDateNear() === true) {
            console.log(`[Antigravity] Expiry date is near, refreshing token...`);
            return this.antigravityApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    /**
     * 获取用量限制信息
     * @returns {Promise<Object>} 用量限制信息
     */
    async getUsageLimits() {
        if (!this.antigravityApiService.isInitialized) {
            console.warn("antigravityApiService not initialized, attempting to re-initialize...");
            await this.antigravityApiService.initialize();
        }
        return this.antigravityApiService.getUsageLimits();
    }
}

// OpenAI API 服务适配器
export class OpenAIApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.openAIApiService = new OpenAIApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter now expects the requestBody to be in the native OpenAI format.
        // The conversion logic is handled upstream in the server.
        return this.openAIApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter now expects the requestBody to be in the native OpenAI format.
        const stream = this.openAIApiService.generateContentStream(model, requestBody);
        // The stream is yielded directly without conversion.
        yield* stream;
    }

    async listModels() {
        // The adapter now returns the native model list from the underlying service.
        return this.openAIApiService.listModels();
    }

    async refreshToken() {
        // OpenAI API keys are typically static and do not require refreshing.
        return Promise.resolve();
    }
}

// OpenAI Responses API 服务适配器
export class OpenAIResponsesApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.openAIResponsesApiService = new OpenAIResponsesApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter expects the requestBody to be in the OpenAI Responses format.
        return this.openAIResponsesApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter expects the requestBody to be in the OpenAI Responses format.
        const stream = this.openAIResponsesApiService.generateContentStream(model, requestBody);
        yield* stream;
    }

    async listModels() {
        // The adapter returns the native model list from the underlying service.
        return this.openAIResponsesApiService.listModels();
    }

    async refreshToken() {
        // OpenAI API keys are typically static and do not require refreshing.
        return Promise.resolve();
    }
}

// Claude API 服务适配器
export class ClaudeApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.claudeApiService = new ClaudeApiService(config);
    }

    async generateContent(model, requestBody) {
        // The adapter now expects the requestBody to be in the native Claude format.
        return this.claudeApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter now expects the requestBody to be in the native Claude format.
        const stream = this.claudeApiService.generateContentStream(model, requestBody);
        yield* stream;
    }

    async listModels() {
        // The adapter now returns the native model list from the underlying service.
        return this.claudeApiService.listModels();
    }

    async refreshToken() {
        return Promise.resolve();
    }
}

// Kiro API 服务适配器
export class KiroApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.kiroApiService = new KiroApiService(config);
        // this.kiroApiService.initialize().catch(error => {
        //     console.error("Failed to initialize kiroApiService:", error);
        // });
    }

    async generateContent(model, requestBody) {
        // The adapter expects the requestBody to be in OpenAI format for Kiro API
        if (!this.kiroApiService.isInitialized) {
            console.warn("kiroApiService not initialized, attempting to re-initialize...");
            await this.kiroApiService.initialize();
        }
        return this.kiroApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // The adapter expects the requestBody to be in OpenAI format for Kiro API
        if (!this.kiroApiService.isInitialized) {
            console.warn("kiroApiService not initialized, attempting to re-initialize...");
            await this.kiroApiService.initialize();
        }
        const stream = this.kiroApiService.generateContentStream(model, requestBody);
        yield* stream;
    }

    async listModels() {
        // Returns the native model list from the Kiro service
        if (!this.kiroApiService.isInitialized) {
            console.warn("kiroApiService not initialized, attempting to re-initialize...");
            await this.kiroApiService.initialize();
        }
        return this.kiroApiService.listModels();
    }

    async refreshToken() {
        if(this.kiroApiService.isExpiryDateNear()===true){
            console.log(`[Kiro] Expiry date is near, refreshing token...`);
            return this.kiroApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    /**
     * 获取用量限制信息
     * @returns {Promise<Object>} 用量限制信息
     */
    async getUsageLimits() {
        if (!this.kiroApiService.isInitialized) {
            console.warn("kiroApiService not initialized, attempting to re-initialize...");
            await this.kiroApiService.initialize();
        }
        return this.kiroApiService.getUsageLimits();
    }

    /**
     * Count tokens for a message request (compatible with Anthropic API)
     * @param {Object} requestBody - The request body containing model, messages, system, tools, etc.
     * @returns {Object} { input_tokens: number }
     */
    countTokens(requestBody) {
        return this.kiroApiService.countTokens(requestBody);
    }
}

// Orchids API 服务适配器
export class OrchidsApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.orchidsApiService = new OrchidsApiService(config);
    }

    async generateContent(model, requestBody) {
        if (!this.orchidsApiService.isInitialized) {
            await this.orchidsApiService.initialize();
        }
        return this.orchidsApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.orchidsApiService.isInitialized) {
            await this.orchidsApiService.initialize();
        }
        yield* this.orchidsApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        return this.orchidsApiService.listModels();
    }

    async refreshToken() {
        if (this.orchidsApiService.isExpiryDateNear()) {
            return this.orchidsApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

    async getUsageLimits() {
        if (!this.orchidsApiService.isInitialized) {
            await this.orchidsApiService.initialize();
        }
        return this.orchidsApiService.getUsageLimits();
    }

    countTokens(requestBody) {
        return this.orchidsApiService.countTokens(requestBody);
    }
}

// Qwen API 服务适配器
export class QwenApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.qwenApiService = new QwenApiService(config);
    }

    async generateContent(model, requestBody) {
        if (!this.qwenApiService.isInitialized) {
            console.warn("qwenApiService not initialized, attempting to re-initialize...");
            await this.qwenApiService.initialize();
        }
        return this.qwenApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.qwenApiService.isInitialized) {
            console.warn("qwenApiService not initialized, attempting to re-initialize...");
            await this.qwenApiService.initialize();
        }
        yield* this.qwenApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.qwenApiService.isInitialized) {
            console.warn("qwenApiService not initialized, attempting to re-initialize...");
            await this.qwenApiService.initialize();
        }
        return this.qwenApiService.listModels();
    }

    async refreshToken() {
        if (this.qwenApiService.isExpiryDateNear()) {
            console.log(`[Qwen] Expiry date is near, refreshing token...`);
            return this.qwenApiService._initializeAuth(true);
        }
        return Promise.resolve();
    }
}

// iFlow API 服务适配器
export class IFlowApiServiceAdapter extends ApiServiceAdapter {
    constructor(config) {
        super();
        this.iflowApiService = new IFlowApiService(config);
    }

    async generateContent(model, requestBody) {
        if (!this.iflowApiService.isInitialized) {
            console.warn("iflowApiService not initialized, attempting to re-initialize...");
            await this.iflowApiService.initialize();
        }
        return this.iflowApiService.generateContent(model, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        if (!this.iflowApiService.isInitialized) {
            console.warn("iflowApiService not initialized, attempting to re-initialize...");
            await this.iflowApiService.initialize();
        }
        yield* this.iflowApiService.generateContentStream(model, requestBody);
    }

    async listModels() {
        if (!this.iflowApiService.isInitialized) {
            console.warn("iflowApiService not initialized, attempting to re-initialize...");
            await this.iflowApiService.initialize();
        }
        return this.iflowApiService.listModels();
    }

    async refreshToken() {
        if (this.iflowApiService.isExpiryDateNear()) {
            console.log(`[iFlow] Expiry date is near, refreshing API key...`);
            await this.iflowApiService.initializeAuth(true);
        }
        return Promise.resolve();
    }

}

// 用于存储服务适配器单例的映射
export const serviceInstances = {};

// 服务适配器工厂
export function getServiceAdapter(config) {
    const customNameDisplay = config.customName ? ` (${config.customName})` : '';
    console.log(`[Adapter] getServiceAdapter, provider: ${config.MODEL_PROVIDER}, uuid: ${config.uuid}${customNameDisplay}`);
    const provider = config.MODEL_PROVIDER;
    const providerKey = config.uuid ? provider + config.uuid : provider;
    if (!serviceInstances[providerKey]) {
        switch (provider) {
            case MODEL_PROVIDER.OPENAI_CUSTOM:
                serviceInstances[providerKey] = new OpenAIApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES:
                serviceInstances[providerKey] = new OpenAIResponsesApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.GEMINI_CLI:
                serviceInstances[providerKey] = new GeminiApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.ANTIGRAVITY:
                serviceInstances[providerKey] = new AntigravityApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.CLAUDE_CUSTOM:
                serviceInstances[providerKey] = new ClaudeApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.KIRO_API:
                serviceInstances[providerKey] = new KiroApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.QWEN_API:
                serviceInstances[providerKey] = new QwenApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.IFLOW_API:
                serviceInstances[providerKey] = new IFlowApiServiceAdapter(config);
                break;
            case MODEL_PROVIDER.ORCHIDS_API:
                serviceInstances[providerKey] = new OrchidsApiServiceAdapter(config);
                break;
            default:
                throw new Error(`Unsupported model provider: ${provider}`);
        }
    }
    return serviceInstances[providerKey];
}
