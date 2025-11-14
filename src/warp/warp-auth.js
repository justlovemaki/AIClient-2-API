/**
 * @file Warp API Authentication Manager
 * @description Centralized authentication manager for Warp API with persistent refresh token storage.
 * Handles JWT lifecycle and automatic token refresh using WARP_REFRESH_TOKEN from config.json.
 * Implements single-account authentication flow without account pooling.
 * 
 * IMPORTANT: Requires WARP_REFRESH_TOKEN to be configured in config.json.
 * Does NOT support anonymous account creation - user must provide their own refresh token.
 */

import axios from 'axios';
import fs from 'fs';
import warpConfig from './warp-config.js';
import { CONFIG } from '../config-manager.js';

class WarpAuthManager {
    constructor() {
        // In-memory token storage
        this.jwt = null;
        this.refreshToken = null;
        
        // Load tokens from config on initialization
        this._loadTokensFromConfig();
    }
    
    /**
     * Load tokens from CONFIG into memory
     * Called lazily when tokens are needed
     * Priority: 1) Environment variables, 2) CONFIG object
     */
    _loadTokensFromConfig() {
        // Priority 1: Environment variables (highest priority)
        this.jwt = process.env.WARP_JWT || null;
        this.refreshToken = process.env.WARP_REFRESH_TOKEN || null;
        
        // Priority 2: CONFIG (global config) - fallback if env vars not set
        try {
            if (CONFIG && typeof CONFIG === 'object') {
                this.jwt = this.jwt || CONFIG.WARP_JWT || null;
                this.refreshToken = this.refreshToken || CONFIG.WARP_REFRESH_TOKEN || null;
            }
        } catch (e) {
            // CONFIG not yet initialized, skip
        }
        
        if (this.jwt) {
            console.log('[Warp Auth] JWT loaded from config');
        }
        if (this.refreshToken) {
            console.log('[Warp Auth] Refresh token loaded from config');
        } else {
            console.warn('[Warp Auth] WARP_REFRESH_TOKEN not found in config');
        }
    }

    /**
     * Decode JWT payload to check expiration
     */
    decodeJWTPayload(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                return {};
            }
            
            let payloadB64 = parts[1];
            // Add padding if needed
            const padding = 4 - (payloadB64.length % 4);
            if (padding !== 4) {
                payloadB64 += '='.repeat(padding);
            }
            
            const payloadBytes = Buffer.from(payloadB64, 'base64url');
            const payload = JSON.parse(payloadBytes.toString('utf-8'));
            return payload;
        } catch (error) {
            // Ignore JWT decode errors
            return {};
        }
    }

    /**
     * Check if token is expired
     */
    isTokenExpired(token, bufferMinutes = 5) {
        const payload = this.decodeJWTPayload(token);
        if (!payload || !payload.exp) {
            return true;
        }
        
        const expiryTime = payload.exp;
        const currentTime = Math.floor(Date.now() / 1000);
        const bufferTime = bufferMinutes * 60;
        
        return (expiryTime - currentTime) <= bufferTime;
    }

    /**
     * Refresh JWT token using refresh token
     * @returns {Promise<object>} Token data with access_token and optionally refresh_token
     */
    async refreshJWTToken() {
        console.log('[Warp Auth] Refreshing JWT token...');
        
        if (!this.refreshToken) {
            console.error('[Warp Auth] WARP_REFRESH_TOKEN is not configured');
            throw new Error('WARP_REFRESH_TOKEN is not configured');
        }
        
        const payload = `grant_type=refresh_token&refresh_token=${this.refreshToken}`;

        const headers = {
            'x-warp-client-version': warpConfig.CLIENT_VERSION,
            'x-warp-os-category': warpConfig.OS_CATEGORY,
            'x-warp-os-name': warpConfig.OS_NAME,
            'x-warp-os-version': warpConfig.OS_VERSION,
            'content-type': 'application/x-www-form-urlencoded',
            'accept': '*/*',
            'accept-encoding': 'gzip, br',
            'content-length': Buffer.byteLength(payload)
        };

        try {
            const response = await axios.post(warpConfig.REFRESH_URL, payload, {
                headers,
                timeout: 30000
            });

            if (response.status === 200) {
                console.log('[Warp Auth] Token refresh successful');
                return response.data;
            } else {
                console.error(`[Warp Auth] Token refresh failed: ${response.status}`);
                console.error(`[Warp Auth] Response: ${JSON.stringify(response.data)}`);
                throw new Error(`Token refresh failed: HTTP ${response.status}`);
            }
        } catch (error) {
            console.error(`[Warp Auth] Error refreshing token: ${error.message}`);
            if (error.response) {
                console.error(`[Warp Auth] Response status: ${error.response.status}`);
                console.error(`[Warp Auth] Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }



    /**
     * Get valid JWT token (main entry point for authentication)
     * @param {boolean} forceRefresh - Force token refresh even if current token is valid
     * @returns {Promise<string>} Valid JWT token
     */
    async getValidJWT(forceRefresh = false) {
        // Reload tokens from config (in case they were updated)
        this._loadTokensFromConfig();
        
        // 1. If JWT exists and is not expired (and no force refresh), return it
        if (this.jwt && !this.isTokenExpired(this.jwt, 5) && !forceRefresh) {
            return this.jwt;
        }

        // 2. If refresh token exists, try to refresh JWT
        if (this.refreshToken) {
            console.log('[Warp Auth] JWT expired or missing. Refreshing using refresh token...');
            const tokenData = await this.refreshJWTToken();
            
            if (tokenData && tokenData.access_token) {
                this.jwt = tokenData.access_token;
                
                // If server returned new refresh token, save it
                if (tokenData.refresh_token) {
                    this.refreshToken = tokenData.refresh_token;
                    this._saveRefreshTokenToConfig(this.refreshToken);
                }
                
                return this.jwt;
            }
        }

        // 3. No refresh token available - throw error
        throw new Error('WARP_REFRESH_TOKEN is not configured in config.json. Please provide a valid refresh token.');
    }
    
    /**
     * Save refresh token to config.json (persistent storage)
     * CRITICAL: This ensures refresh token survives application restarts
     */
    _saveRefreshTokenToConfig(refreshToken) {
        const configPath = process.cwd() + '/config.json';
        
        try {
            // Update in-memory warpConfig
            warpConfig.WARP_REFRESH_TOKEN = refreshToken;
            
            // Try to update CONFIG if available (avoid circular dependency)
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG) {
                    CONFIG.WARP_REFRESH_TOKEN = refreshToken;
                }
            } catch (e) {
                // CONFIG not available, skip
            }
            
            // Read current config.json
            let configData = {};
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                configData = JSON.parse(configContent);
            }
            
            // Update refresh token
            configData.WARP_REFRESH_TOKEN = refreshToken;
            
            // Write back to config.json
            fs.writeFileSync(configPath, JSON.stringify(configData, null, 4), 'utf-8');
            console.log('[Warp Auth] Refresh token saved to config.json');
        } catch (error) {
            console.error(`[Warp Auth] Failed to save refresh token: ${error.message}`);
        }
    }
}

// Export singleton instance
const warpAuthManager = new WarpAuthManager();
export default warpAuthManager;

// Export class for direct instantiation if needed
export { WarpAuthManager };

// Export individual methods for convenience (bound to singleton)
export const decodeJWTPayload = warpAuthManager.decodeJWTPayload.bind(warpAuthManager);
export const refreshJWTToken = warpAuthManager.refreshJWTToken.bind(warpAuthManager);
export const getValidJWT = warpAuthManager.getValidJWT.bind(warpAuthManager);
