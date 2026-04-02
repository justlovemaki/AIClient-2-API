import WebSocket from 'ws';
import logger from '../../utils/logger.js';
import { getProxyConfigForProvider } from '../../utils/proxy-utils.js';
import { MODEL_PROVIDER } from '../../utils/common.js';

/**
 * Grok WebSocket Imagine Service
 * Handles image generation via Grok's WebSocket endpoint.
 */
export class ImagineWebSocketService {
    constructor(config) {
        this.config = config;
        this.baseUrl = (config.GROK_BASE_URL || 'https://grok.com').replace(/\/$/, '');
        this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/rpc/imagine/streaming';
    }

    /**
     * Start an image generation stream via WebSocket.
     * 
     * @param {string} token - SSO token
     * @param {string} prompt - Image prompt
     * @param {string} aspectRatio - Aspect ratio (e.g. "1:1")
     * @param {number} n - Number of images
     * @param {boolean} enableNsfw - Enable NSFW filter
     * @returns {AsyncGenerator<object>}
     */
    async *stream(token, prompt, aspectRatio = '1:1', n = 1, enableNsfw = true) {
        const proxyConfig = getProxyConfigForProvider(this.config, MODEL_PROVIDER.GROK_CUSTOM);
        const agent = proxyConfig?.httpsAgent;

        let ssoToken = token || "";
        if (ssoToken.startsWith("sso=")) ssoToken = ssoToken.substring(4);
        const cookie = ssoToken ? `sso=${ssoToken}; sso-rw=${ssoToken}` : "";

        const headers = {
            'Cookie': cookie,
            'Origin': this.baseUrl,
            'User-Agent': this.config.GROK_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        };

        logger.debug(`[Grok WS] Connecting to ${this.wsUrl} for prompt: ${prompt.substring(0, 50)}...`);

        const ws = new WebSocket(this.wsUrl, {
            headers,
            agent,
            handshakeTimeout: 15000,
            rejectUnauthorized: false
        });

        const queue = [];
        let done = false;
        let resolveNext = null;

        ws.on('open', () => {
            logger.debug(`[Grok WS] Connected. Sending imagine request.`);
            ws.send(JSON.stringify({
                method: 'imagine',
                params: {
                    prompt,
                    aspectRatio,
                    count: n,
                    enableNsfw
                }
            }));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                queue.push(msg);
                if (resolveNext) {
                    resolveNext();
                    resolveNext = null;
                }
            } catch (e) {
                logger.error(`[Grok WS] Failed to parse message: ${data.toString().substring(0, 100)}`);
            }
        });

        ws.on('close', (code, reason) => {
            logger.debug(`[Grok WS] Connection closed: ${code} ${reason}`);
            done = true;
            if (resolveNext) {
                resolveNext();
                resolveNext = null;
            }
        });

        ws.on('error', (err) => {
            logger.error(`[Grok WS] WebSocket error: ${err.message}`);
            queue.push({ type: 'error', error: err.message });
            done = true;
            if (resolveNext) {
                resolveNext();
                resolveNext = null;
            }
        });

        try {
            while (!done || queue.length > 0) {
                if (queue.length === 0 && !done) {
                    await new Promise(r => resolveNext = r);
                }
                while (queue.length > 0) {
                    yield queue.shift();
                }
            }
        } finally {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        }
    }
}
