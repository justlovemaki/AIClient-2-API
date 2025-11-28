/**
 * 转换器基类
 * 使用策略模式定义转换器的通用接口
 */

/**
 * 抽象转换器基类
 * 所有具体的协议转换器都应继承此类
 */
export class BaseConverter {
    constructor(protocolName) {
        if (new.target === BaseConverter) {
            throw new Error('BaseConverter是抽象类，不能直接实例化');
        }
        this.protocolName = protocolName;
    }

    /**
     * 转换请求
     * @param {Object} data - 请求数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的请求
     */
    convertRequest(data, targetProtocol) {
        throw new Error('convertRequest方法必须被子类实现');
    }

    /**
     * 转换响应
     * @param {Object} data - 响应数据
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的响应
     */
    convertResponse(data, targetProtocol, model) {
        throw new Error('convertResponse方法必须被子类实现');
    }

    /**
     * 转换流式响应块
     * @param {Object} chunk - 流式响应块
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        throw new Error('convertStreamChunk方法必须被子类实现');
    }

    /**
     * 转换模型列表
     * @param {Object} data - 模型列表数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的模型列表
     */
    convertModelList(data, targetProtocol) {
        throw new Error('convertModelList方法必须被子类实现');
    }

    /**
     * 获取协议名称
     * @returns {string} 协议名称
     */
    getProtocolName() {
        return this.protocolName;
    }
}

/**
 * 内容处理器接口
 * 用于处理不同类型的内容（文本、图片、音频等）
 */
export class ContentProcessor {
    /**
     * 处理内容
     * @param {*} content - 内容数据
     * @returns {*} 处理后的内容
     */
    process(content) {
        throw new Error('process方法必须被子类实现');
    }
}

/**
 * 工具处理器接口
 * 用于处理工具调用相关的转换
 */
export class ToolProcessor {
    /**
     * 处理工具定义
     * @param {Array} tools - 工具定义数组
     * @returns {Array} 处理后的工具定义
     */
    processToolDefinitions(tools) {
        throw new Error('processToolDefinitions方法必须被子类实现');
    }

    /**
     * 处理工具调用
     * @param {Object} toolCall - 工具调用数据
     * @returns {Object} 处理后的工具调用
     */
    processToolCall(toolCall) {
        throw new Error('processToolCall方法必须被子类实现');
    }

    /**
     * 处理工具结果
     * @param {Object} toolResult - 工具结果数据
     * @returns {Object} 处理后的工具结果
     */
    processToolResult(toolResult) {
        throw new Error('processToolResult方法必须被子类实现');
    }
}