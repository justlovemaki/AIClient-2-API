import logger from '../../utils/logger.js';

/**
 * AI 接口监控插件
 * 功能：
 * 1. 捕获 AI 接口的请求参数（转换前和转换后）
 * 2. 捕获 AI 接口的响应结果（转换前和转换后，流式响应聚合输出）
 */
const aiMonitorPlugin = {
    name: 'ai-monitor',
    version: '1.0.0',
    description: 'AI 接口监控插件 - 捕获请求和响应参数（全链路协议转换监控，流式聚合输出，用于调试和分析）',
    type: 'middleware',
    _priority: 100,

    // 用于存储流式响应的中间状态
    streamCache: new Map(),

    async init(config) {
        logger.info('[AI Monitor Plugin] Initialized');
    },

    /**
     * 中间件：初始化请求上下文
     */
    async middleware(req, res, requestUrl, config) {
        const aiPaths = ['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1beta/models'];
        const isAiPath = aiPaths.some(path => requestUrl.pathname.includes(path));

        if (isAiPath && req.method === 'POST') {
            // 在监控插件中生成请求标识，并存入 config 以供全链路追踪
            const requestId = Date.now() + Math.random().toString(36).substring(2, 10);
            config._monitorRequestId = requestId;
        }
        
        return { handled: false };
    },

    hooks: {
        /**
         * 请求转换后的钩子
         */
        async onContentGenerated(config) {
            const { originalRequestBody, processedRequestBody, fromProvider, toProvider, model, _monitorRequestId, isStream } = config;
            if (!originalRequestBody) return;

            setImmediate(() => {
                const hasConversion = JSON.stringify(originalRequestBody) !== JSON.stringify(processedRequestBody);
                logger.info(`[AI Monitor][${_monitorRequestId}] >>> Req Protocol: ${fromProvider}${hasConversion ? ' -> ' + toProvider : ''} | Model: ${model}`);
                
                if (hasConversion) {
                    logger.info(`[AI Monitor][${_monitorRequestId}] [Req Original]: ${JSON.stringify(originalRequestBody)}`);
                    logger.info(`[AI Monitor][${_monitorRequestId}] [Req Processed]: ${JSON.stringify(processedRequestBody)}`);
                } else {
                    logger.info(`[AI Monitor][${_monitorRequestId}] [Req]: ${JSON.stringify(originalRequestBody)}`);
                }
            });

            // 处理流式响应的聚合输出
            if (isStream && _monitorRequestId) {
                setTimeout(() => {
                    const cache = aiMonitorPlugin.streamCache.get(_monitorRequestId);
                    if (cache) {
                        const hasConversion = JSON.stringify(cache.nativeChunks) !== JSON.stringify(cache.convertedChunks);
                        logger.info(`[AI Monitor][${_monitorRequestId}] <<< Stream Response Aggregated: ${hasConversion ? cache.toProvider + ' -> ' : ''}${cache.fromProvider}`);
                        
                        if (hasConversion) {
                            logger.info(`[AI Monitor][${_monitorRequestId}] [Res Native Full]: ${JSON.stringify(cache.nativeChunks)}`);
                            logger.info(`[AI Monitor][${_monitorRequestId}] [Res Converted Full]: ${JSON.stringify(cache.convertedChunks)}`);
                        } else {
                            logger.info(`[AI Monitor][${_monitorRequestId}] [Res Full]: ${JSON.stringify(cache.nativeChunks)}`);
                        }
                        
                        aiMonitorPlugin.streamCache.delete(_monitorRequestId);
                    }
                }, 2000); // 等待流传输完成
            }
        },

        /**
         * 非流式响应转换监控
         */
        async onUnaryResponse({ nativeResponse, clientResponse, fromProvider, toProvider, requestId }) {
            setImmediate(() => {
                const reqId = requestId || 'N/A';
                const hasConversion = JSON.stringify(nativeResponse) !== JSON.stringify(clientResponse);
                logger.info(`[AI Monitor][${reqId}] <<< Res Protocol: ${hasConversion ? toProvider + ' -> ' : ''}${fromProvider} (Unary)`);
                
                if (hasConversion) {
                    logger.info(`[AI Monitor][${reqId}] [Res Native]: ${JSON.stringify(nativeResponse)}`);
                    logger.info(`[AI Monitor][${reqId}] [Res Converted]: ${JSON.stringify(clientResponse)}`);
                } else {
                    logger.info(`[AI Monitor][${reqId}] [Res]: ${JSON.stringify(nativeResponse)}`);
                }
            });
        },

        /**
         * 流式响应分块转换监控 - 聚合数据
         */
        async onStreamChunk({ nativeChunk, chunkToSend, fromProvider, toProvider, requestId }) {
            if (!requestId) return;

            if (!aiMonitorPlugin.streamCache.has(requestId)) {
                aiMonitorPlugin.streamCache.set(requestId, {
                    nativeChunks: [],
                    convertedChunks: [],
                    fromProvider,
                    toProvider
                });
            }

            const cache = aiMonitorPlugin.streamCache.get(requestId);
            
            // 过滤 null 值，并判断是否为数组类型
            if (nativeChunk != null) {
                if (Array.isArray(nativeChunk)) {
                    cache.nativeChunks.push(...nativeChunk.filter(item => item != null));
                } else {
                    cache.nativeChunks.push(nativeChunk);
                }
            }
            
            if (chunkToSend != null) {
                if (Array.isArray(chunkToSend)) {
                    cache.convertedChunks.push(...chunkToSend.filter(item => item != null));
                } else {
                    cache.convertedChunks.push(chunkToSend);
                }
            }
        },

        /**
         * 内部请求转换监控
         */
        async onInternalRequestConverted({ requestId, internalRequest, converterName }) {
            setImmediate(() => {
                const reqId = requestId || 'N/A';
                logger.info(`[AI Monitor][${reqId}] >>> Internal Req Converted [${converterName}]: ${JSON.stringify(internalRequest)}`);
            });
        }
    }
};

export default aiMonitorPlugin;