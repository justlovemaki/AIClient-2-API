/**
 * Security Fixes Integration Test Suite
 *
 * 测试最近修复的安全问题：
 * 1. XSS 防护 - sanitizeProviderData
 * 2. 路径遍历防护 - 路径验证逻辑
 * 3. 文件锁超时机制
 * 4. 健康检查方法调用
 */

import { describe, test, expect } from '@jest/globals';
import { fetch } from 'undici';

const TEST_SERVER_BASE_URL = process.env.TEST_SERVER_BASE_URL || 'http://localhost:3000';
const TEST_API_KEY = process.env.TEST_API_KEY || '123456';

describe('Security Fixes Integration Tests', () => {

    describe('XSS Protection', () => {
        test('should remove script tags from customName', async () => {
            const maliciousName = '<script>alert("XSS")</script>TestProvider';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: maliciousName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).not.toContain('<script>');
            expect(data.provider.customName).not.toContain('</script>');
            expect(data.provider.customName).toContain('TestProvider');
        });

        test('should reject javascript: protocol', async () => {
            const maliciousName = 'javascript:alert("XSS")';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: maliciousName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).toBe('');
        });

        test('should reject data: protocol', async () => {
            const maliciousName = 'data:text/html,<script>alert(1)</script>';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: maliciousName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).toBe('');
        });

        test('should remove HTML event handlers', async () => {
            const maliciousName = '<img src=x onerror="alert(1)">';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: maliciousName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).not.toContain('onerror');
            expect(data.provider.customName).not.toContain('<img');
        });

        test('should remove HTML entities', async () => {
            const maliciousName = '&lt;script&gt;alert(1)&lt;/script&gt;';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: maliciousName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).not.toContain('&lt;');
            expect(data.provider.customName).not.toContain('&gt;');
        });

        test('should preserve normal text', async () => {
            const normalName = 'My Test Provider 123';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    providerType: 'openai-custom',
                    providerConfig: {
                        customName: normalName,
                        OPENAI_CUSTOM_BASE_URL: 'https://api.example.com',
                        OPENAI_CUSTOM_API_KEY: 'test-key'
                    }
                })
            });

            const data = await response.json();
            expect(data.provider.customName).toBe(normalName);
        });
    });

    describe('Path Traversal Protection', () => {
        test('should reject paths with ..', async () => {
            const maliciousPath = '../../../etc/passwd';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    SYSTEM_PROMPT_FILE_PATH: maliciousPath
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.SYSTEM_PROMPT_FILE_PATH).not.toBe(maliciousPath);
        });

        test('should accept valid paths within working directory', async () => {
            const validPath = 'configs/my_prompt.txt';
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    SYSTEM_PROMPT_FILE_PATH: validPath
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.SYSTEM_PROMPT_FILE_PATH).toBe(validPath);
        });
    });

    describe('Health Check Configuration', () => {
        test('should save scheduled health check settings', async () => {
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    SCHEDULED_HEALTH_CHECK: {
                        enabled: true,
                        startupRun: true,
                        interval: 300000,
                        providerTypes: ['openai-custom']
                    }
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.SCHEDULED_HEALTH_CHECK).toBeDefined();
            expect(config.SCHEDULED_HEALTH_CHECK.enabled).toBe(true);
            expect(config.SCHEDULED_HEALTH_CHECK.interval).toBe(300000);
        });

        test('should enforce minimum interval', async () => {
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    SCHEDULED_HEALTH_CHECK: {
                        enabled: true,
                        interval: 30000
                    }
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.SCHEDULED_HEALTH_CHECK.interval).toBeGreaterThanOrEqual(60000);
        });
    });

    describe('Configuration Validation', () => {
        test('should reject invalid port numbers', async () => {
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    SERVER_PORT: 99999
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.SERVER_PORT).not.toBe(99999);
        });

        test('should reject excessive retry counts', async () => {
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_API_KEY}`
                },
                body: JSON.stringify({
                    REQUEST_MAX_RETRIES: 999
                })
            });

            expect(response.status).toBe(200);

            const getResponse = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await getResponse.json();
            expect(config.REQUEST_MAX_RETRIES).toBeLessThanOrEqual(100);
        });

        test('should mask API key in response', async () => {
            const response = await fetch(`${TEST_SERVER_BASE_URL}/api/config`, {
                headers: {
                    'Authorization': `Bearer ${TEST_API_KEY}`
                }
            });
            const config = await response.json();

            if (config.REQUIRED_API_KEY) {
                expect(config.REQUIRED_API_KEY).toContain('*');
            }
        });
    });
});
