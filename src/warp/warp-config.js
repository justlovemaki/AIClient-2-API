/**
 * Warp API Configuration
 * Adapted from Python warp2protobuf/config/settings.py
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WarpConfig {
    constructor() {
        // Path configurations
        this.SCRIPT_DIR = path.resolve(__dirname, '../..');
        this.PROTO_DIR = path.join(this.SCRIPT_DIR, 'proto');
        this.LOGS_DIR = path.join(this.SCRIPT_DIR, 'logs');

        // API configuration - will be set from config later
        this.WARP_URL = process.env.WARP_URL || 'https://app.warp.dev/ai/multi-agent';

        // Environment variables with defaults
        this.HOST = process.env.WARP_HOST || '0.0.0.0';
        this.PORT = parseInt(process.env.WARP_PORT || '8002', 10);
        this.WARP_JWT = process.env.WARP_JWT || null;

        // Client headers configuration
        this.CLIENT_VERSION = 'v0.2025.08.06.08.12.stable_02';
        this.OS_CATEGORY = 'Windows';
        this.OS_NAME = 'Windows';
        this.OS_VERSION = '11 (26100)';

        // Protobuf field names for text detection
        this.TEXT_FIELD_NAMES = ['text', 'prompt', 'query', 'content', 'message', 'input'];
        this.PATH_HINT_BONUS = ['conversation', 'query', 'input', 'user', 'request', 'delta'];

        // Response parsing configuration
        this.SYSTEM_STR = new Set([
            'agent_output.text',
            'server_message_data',
            'USER_INITIATED',
            'agent_output',
            'text'
        ]);

        // JWT refresh configuration - will be set from config later
        this.WARP_REFRESH_TOKEN = process.env.WARP_REFRESH_TOKEN || null;
        this.REFRESH_URL = process.env.WARP_REFRESH_URL || 'https://app.warp.dev/proxy/token?key=AIzaSyBdy3O3S9hrdayLJxJ7mriBR4qgUaUygAs';

        // Ensure directories exist
        this.ensureDirectories();
    }

    /**
     * Update configuration from global CONFIG object
     * This should be called after CONFIG is initialized
     */
    updateFromConfig(config) {
        if (!config) return;

        // Update from config, environment variables take precedence
        if (config.WARP_URL) {
            this.WARP_URL = process.env.WARP_URL || config.WARP_URL;
        }
        if (config.WARP_JWT !== undefined) {
            this.WARP_JWT = process.env.WARP_JWT || config.WARP_JWT;
        }
        if (config.WARP_REFRESH_TOKEN) {
            this.WARP_REFRESH_TOKEN = process.env.WARP_REFRESH_TOKEN || config.WARP_REFRESH_TOKEN;
            console.log('[Warp Config] WARP_REFRESH_TOKEN updated:', this.WARP_REFRESH_TOKEN ? 'present' : 'MISSING');
        }
        if (config.WARP_REFRESH_URL) {
            this.REFRESH_URL = process.env.WARP_REFRESH_URL || config.WARP_REFRESH_URL;
        }
    }

    ensureDirectories() {
        [this.LOGS_DIR, this.PROTO_DIR].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * Get JWT token from environment or config
     */
    getJWT() {
        return this.WARP_JWT;
    }

    /**
     * Set JWT token
     */
    setJWT(token) {
        this.WARP_JWT = token;
    }

    /**
     * Get client headers for Warp API requests
     */
    getClientHeaders(jwt = null) {
        const headers = {
            'Content-Type': 'application/x-protobuf',
            'User-Agent': `Warp/${this.CLIENT_VERSION} (${this.OS_NAME} ${this.OS_VERSION})`,
            'X-Client-Version': this.CLIENT_VERSION,
            'X-OS-Category': this.OS_CATEGORY,
            'X-OS-Name': this.OS_NAME,
            'X-OS-Version': this.OS_VERSION
        };

        const token = jwt || this.WARP_JWT;
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return headers;
    }

    /**
     * Check if text field name matches known patterns
     */
    isTextField(fieldName) {
        return this.TEXT_FIELD_NAMES.includes(fieldName.toLowerCase());
    }

    /**
     * Check if path contains hint bonus keywords
     */
    hasPathHintBonus(path) {
        const lowerPath = path.toLowerCase();
        return this.PATH_HINT_BONUS.some(hint => lowerPath.includes(hint));
    }
}

// Export singleton instance
const warpConfig = new WarpConfig();
export default warpConfig;
