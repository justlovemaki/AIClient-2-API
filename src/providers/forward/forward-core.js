import axios from 'axios';
import logger from '../../utils/logger.js';
import * as http from 'http';
import * as https from 'https';
import { configureAxiosProxy } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError } from '../../utils/common.js';

/**
 * ForwardApiService - A provider that forwards requests to a specified API endpoint.
 * Transparently passes all parameters and includes an API key in the headers.
 */
export class ForwardApiService {
    constructor(config) {
        if (!config.FORWARD_API_KEY) {
            throw new Error("API Key is required for ForwardApiService (FORWARD_API_KEY).");
        }
        if (!config.FORWARD_BASE_URL) {
            throw new Error("Base URL is required for ForwardApiService (FORWARD_BASE_URL).");
        }
        
        this.config = config;
        this.apiKey = config.FORWARD_API_KEY;
        this.baseUrl = config.FORWARD_BASE_URL;
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_FORWARD ?? false;
        this.headerName = config?.FORWARD_HEADER_NAME || 'Authorization';
        this.headerValuePrefix = config?.FORWARD_HEADER_VALUE_PREFIX || 'Bearer ';

        logger.info(`[Forward] Base URL: ${this.baseUrl}, System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);

        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });

        const headers = {
            'Content-Type': 'application/json'
        };
        headers[this.headerName] = `${this.headerValuePrefix}${this.apiKey}`;

        const axiosConfig = {
            baseURL: this.baseUrl,
            httpAgent,
            httpsAgent,
            headers,
        };
        
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        configureAxiosProxy(axiosConfig, config, 'forward-custom');
        
        this.axiosInstance = axios.create(axiosConfig);
    }

    async callApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        try {
            const response = await this.axiosInstance.post(endpoint, body);
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            const isNetworkError = isRetryableNetworkError(error);
            
            if (status === 401 || status === 403) {
                logger.error(`[Forward API] Received ${status}. API Key might be invalid or expired.`);
                throw error;
            }

            if ((status === 429 || (status >= 500 && status < 600) || isNetworkError) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Forward API] Error ${status || errorCode}. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(endpoint, body, isRetry, retryCount + 1);
            }

            logger.error(`[Forward API] Error calling API (Status: ${status}, Code: ${errorCode}):`, errorMessage);
            throw error;
        }
    }

    async *streamApi(endpoint, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        try {
            const response = await this.axiosInstance.post(endpoint, body, {
                responseType: 'stream'
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                buffer += chunk.toString();
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex).trim();
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.startsWith('data: ')) {
                        const jsonData = line.substring(6).trim();
                        if (jsonData === '[DONE]') {
                            return;
                        }
                        try {
                            const parsedChunk = JSON.parse(jsonData);
                            yield parsedChunk;
                        } catch (e) {
                            // If it's not JSON, it might be a different format, but for a forwarder we try to parse common SSE formats
                            logger.warn("[ForwardApiService] Failed to parse stream chunk JSON:", e.message, "Data:", jsonData);
                        }
                    }
                }
            }
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const isNetworkError = isRetryableNetworkError(error);
            
            if ((status === 429 || (status >= 500 && status < 600) || isNetworkError) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[Forward API] Stream error ${status || errorCode}. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(endpoint, body, isRetry, retryCount + 1);
                return;
            }

            const errorMessage = error.message || '';
            logger.error(`[Forward API] Error calling streaming API (Status: ${status || errorCode}):`, errorMessage);
            throw error;
        }
    }

    async generateContent(model, requestBody) {
        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }

        // Transparently pass the endpoint if provided in requestBody, otherwise use default
        const endpoint = requestBody.endpoint || '';
        return this.callApi(endpoint, requestBody);
    }

    async *generateContentStream(model, requestBody) {
        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }

        const endpoint = requestBody.endpoint || '';
        yield* this.streamApi(endpoint, requestBody);
    }

    async listModels() {
        try {
            const response = await this.axiosInstance.get('/models');
            return response.data;
        } catch (error) {
            logger.error(`Error listing Forward models:`, error.message);
            return { data: [] };
        }
    }
}

