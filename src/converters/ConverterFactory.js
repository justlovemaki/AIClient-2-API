/**
 * 转换器工厂类
 * 使用工厂模式管理转换器实例的创建和缓存
 */

import { MODEL_PROTOCOL_PREFIX } from '../utils/common.js';

/**
 * 转换器工厂（单例模式 + 工厂模式）
 */
export class ConverterFactory {
    // 私有静态属性：存储转换器实例
    static #converters = new Map();
    
    // 私有静态属性：存储转换器类
    static #converterClasses = new Map();

    /**
     * 注册转换器类
     * @param {string} protocolPrefix - 协议前缀
     * @param {Class} ConverterClass - 转换器类
     */
    static registerConverter(protocolPrefix, ConverterClass) {
        this.#converterClasses.set(protocolPrefix, ConverterClass);
    }

    /**
     * 获取转换器实例（带缓存）
     * @param {string} protocolPrefix - 协议前缀
     * @returns {BaseConverter} 转换器实例
     */
    static getConverter(protocolPrefix) {
        // 检查缓存
        if (this.#converters.has(protocolPrefix)) {
            return this.#converters.get(protocolPrefix);
        }

        // 创建新实例
        const converter = this.createConverter(protocolPrefix);
        
        // 缓存实例
        if (converter) {
            this.#converters.set(protocolPrefix, converter);
        }

        return converter;
    }

    /**
     * 创建转换器实例
     * @param {string} protocolPrefix - 协议前缀
     * @returns {BaseConverter} 转换器实例
     */
    static createConverter(protocolPrefix) {
        const ConverterClass = this.#converterClasses.get(protocolPrefix);
        
        if (!ConverterClass) {
            throw new Error(`No converter registered for protocol: ${protocolPrefix}`);
        }

        return new ConverterClass();
    }

    /**
     * 清除所有缓存的转换器
     */
    static clearCache() {
        this.#converters.clear();
    }

    /**
     * 清除特定协议的转换器缓存
     * @param {string} protocolPrefix - 协议前缀
     */
    static clearConverterCache(protocolPrefix) {
        this.#converters.delete(protocolPrefix);
    }

    /**
     * 获取所有已注册的协议
     * @returns {Array<string>} 协议前缀数组
     */
    static getRegisteredProtocols() {
        return Array.from(this.#converterClasses.keys());
    }

    /**
     * 检查协议是否已注册
     * @param {string} protocolPrefix - 协议前缀
     * @returns {boolean} 是否已注册
     */
    static isProtocolRegistered(protocolPrefix) {
        return this.#converterClasses.has(protocolPrefix);
    }
}

/**
 * 内容处理器工厂
 */
export class ContentProcessorFactory {
    static #processors = new Map();

    /**
     * 获取内容处理器
     * @param {string} sourceFormat - 源格式
     * @param {string} targetFormat - 目标格式
     * @returns {ContentProcessor} 内容处理器实例
     */
    static getProcessor(sourceFormat, targetFormat) {
        const key = `${sourceFormat}_to_${targetFormat}`;
        
        if (!this.#processors.has(key)) {
            this.#processors.set(key, this.createProcessor(sourceFormat, targetFormat));
        }
        
        return this.#processors.get(key);
    }

    /**
     * 创建内容处理器
     * @param {string} sourceFormat - 源格式
     * @param {string} targetFormat - 目标格式
     * @returns {ContentProcessor} 内容处理器实例
     */
    static createProcessor(sourceFormat, targetFormat) {
        // 这里返回null，实际使用时需要导入具体的处理器类
        // 为了避免循环依赖，处理器类应该在使用时动态导入
        console.warn(`Content processor for ${sourceFormat} to ${targetFormat} not yet implemented`);
        return null;
    }

    /**
     * 清除所有缓存的处理器
     */
    static clearCache() {
        this.#processors.clear();
    }
}

/**
 * 工具处理器工厂
 */
export class ToolProcessorFactory {
    static #processors = new Map();

    /**
     * 获取工具处理器
     * @param {string} sourceFormat - 源格式
     * @param {string} targetFormat - 目标格式
     * @returns {ToolProcessor} 工具处理器实例
     */
    static getProcessor(sourceFormat, targetFormat) {
        const key = `${sourceFormat}_to_${targetFormat}`;
        
        if (!this.#processors.has(key)) {
            this.#processors.set(key, this.createProcessor(sourceFormat, targetFormat));
        }
        
        return this.#processors.get(key);
    }

    /**
     * 创建工具处理器
     * @param {string} sourceFormat - 源格式
     * @param {string} targetFormat - 目标格式
     * @returns {ToolProcessor} 工具处理器实例
     */
    static createProcessor(sourceFormat, targetFormat) {
        console.warn(`Tool processor for ${sourceFormat} to ${targetFormat} not yet implemented`);
        return null;
    }

    /**
     * 清除所有缓存的处理器
     */
    static clearCache() {
        this.#processors.clear();
    }
}

// 导出工厂类
export default ConverterFactory;