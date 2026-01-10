/**
 * 转换器注册模块
 * 用于注册所有转换器到工厂，避免循环依赖问题
 */

import { MODEL_PROTOCOL_PREFIX } from '../utils/common.js';
import { ConverterFactory } from './ConverterFactory.js';
import { OpenAIConverter } from './strategies/OpenAIConverter.js';
import { OpenAIResponsesConverter } from './strategies/OpenAIResponsesConverter.js';
import { ClaudeConverter } from './strategies/ClaudeConverter.js';
import { GeminiConverter } from './strategies/GeminiConverter.js';
import { OllamaConverter } from './strategies/OllamaConverter.js';

/**
 * 注册所有转换器到工厂
 * 此函数应在应用启动时调用一次
 */
export function registerAllConverters() {
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI, OpenAIConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES, OpenAIResponsesConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.CLAUDE, ClaudeConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.GEMINI, GeminiConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OLLAMA, OllamaConverter);
}

// 自动注册所有转换器
registerAllConverters();