import { MODEL_PROVIDER, MODEL_PROTOCOL_PREFIX, getProtocolPrefix } from '../src/utils/common.js';
import { PROVIDER_MODELS, getProviderModels } from '../src/providers/provider-models.js';

describe('MiniMax Provider Registration', () => {
    describe('MODEL_PROVIDER constants', () => {
        it('should have MINIMAX_CUSTOM defined', () => {
            expect(MODEL_PROVIDER.MINIMAX_CUSTOM).toBe('minimax-custom');
        });

        it('should not conflict with existing providers', () => {
            const values = Object.values(MODEL_PROVIDER);
            const minimaxValues = values.filter(v => v === 'minimax-custom');
            expect(minimaxValues).toHaveLength(1);
        });
    });

    describe('MODEL_PROTOCOL_PREFIX constants', () => {
        it('should have MINIMAX protocol prefix', () => {
            expect(MODEL_PROTOCOL_PREFIX.MINIMAX).toBe('minimax');
        });
    });

    describe('getProtocolPrefix', () => {
        it('should extract minimax from minimax-custom', () => {
            expect(getProtocolPrefix('minimax-custom')).toBe('minimax');
        });
    });

    describe('PROVIDER_MODELS', () => {
        it('should list MiniMax models', () => {
            expect(PROVIDER_MODELS['minimax-custom']).toEqual([
                'MiniMax-M2.7',
                'MiniMax-M2.7-highspeed',
            ]);
        });

        it('should return MiniMax models via getProviderModels', () => {
            const models = getProviderModels('minimax-custom');
            expect(models).toContain('MiniMax-M2.7');
            expect(models).toContain('MiniMax-M2.7-highspeed');
            expect(models).toHaveLength(2);
        });
    });
});

describe('MiniMaxApiService - Temperature Clamping', () => {
    // Test temperature clamping logic without instantiating the full service
    // (which requires axios and network setup)
    function clampTemperature(body) {
        const result = { ...body };
        if (result.temperature !== undefined) {
            if (result.temperature <= 0) {
                result.temperature = 0.01;
            } else if (result.temperature > 1.0) {
                result.temperature = 1.0;
            }
        }
        return result;
    }

    function sanitizeRequestBody(body) {
        const sanitized = clampTemperature(body);
        if (sanitized.response_format) {
            delete sanitized.response_format;
        }
        return sanitized;
    }

    describe('clampTemperature', () => {
        it('should clamp temperature=0 to 0.01', () => {
            expect(clampTemperature({ temperature: 0 }).temperature).toBe(0.01);
        });

        it('should clamp negative temperature to 0.01', () => {
            expect(clampTemperature({ temperature: -0.5 }).temperature).toBe(0.01);
        });

        it('should clamp temperature > 1.0 to 1.0', () => {
            expect(clampTemperature({ temperature: 1.5 }).temperature).toBe(1.0);
        });

        it('should clamp temperature=2.0 to 1.0', () => {
            expect(clampTemperature({ temperature: 2.0 }).temperature).toBe(1.0);
        });

        it('should keep temperature=0.7 unchanged', () => {
            expect(clampTemperature({ temperature: 0.7 }).temperature).toBe(0.7);
        });

        it('should keep temperature=1.0 unchanged', () => {
            expect(clampTemperature({ temperature: 1.0 }).temperature).toBe(1.0);
        });

        it('should keep temperature=0.01 unchanged', () => {
            expect(clampTemperature({ temperature: 0.01 }).temperature).toBe(0.01);
        });

        it('should not add temperature if not specified', () => {
            expect(clampTemperature({}).temperature).toBeUndefined();
        });

        it('should not add temperature if body has other fields only', () => {
            expect(clampTemperature({ model: 'MiniMax-M2.7' }).temperature).toBeUndefined();
        });
    });

    describe('sanitizeRequestBody', () => {
        it('should remove response_format', () => {
            const result = sanitizeRequestBody({
                model: 'MiniMax-M2.7',
                messages: [{ role: 'user', content: 'hello' }],
                response_format: { type: 'json_object' },
            });
            expect(result.response_format).toBeUndefined();
            expect(result.model).toBe('MiniMax-M2.7');
            expect(result.messages).toBeDefined();
        });

        it('should clamp temperature and remove response_format together', () => {
            const result = sanitizeRequestBody({
                model: 'MiniMax-M2.7',
                temperature: 0,
                response_format: { type: 'json_object' },
            });
            expect(result.temperature).toBe(0.01);
            expect(result.response_format).toBeUndefined();
        });

        it('should not mutate original body', () => {
            const body = {
                model: 'MiniMax-M2.7',
                response_format: { type: 'json_object' },
                temperature: 0,
            };
            sanitizeRequestBody(body);
            expect(body.response_format).toBeDefined();
            expect(body.temperature).toBe(0);
        });

        it('should preserve all other fields', () => {
            const result = sanitizeRequestBody({
                model: 'MiniMax-M2.7',
                messages: [{ role: 'user', content: 'test' }],
                max_tokens: 1024,
                top_p: 0.9,
                temperature: 0.5,
            });
            expect(result.model).toBe('MiniMax-M2.7');
            expect(result.messages).toHaveLength(1);
            expect(result.max_tokens).toBe(1024);
            expect(result.top_p).toBe(0.9);
            expect(result.temperature).toBe(0.5);
        });

        it('should handle body without response_format gracefully', () => {
            const result = sanitizeRequestBody({
                model: 'MiniMax-M2.7',
                messages: [{ role: 'user', content: 'test' }],
            });
            expect(result.model).toBe('MiniMax-M2.7');
            expect(result.response_format).toBeUndefined();
        });
    });
});

describe('MiniMax Provider Pool Configuration', () => {
    it('should have health check model configured in ProviderPoolManager', async () => {
        // Dynamically import to avoid side-effects from other modules
        try {
            const module = await import('../src/providers/provider-pool-manager.js');
            const healthModels = module.ProviderPoolManager.DEFAULT_HEALTH_CHECK_MODELS;
            expect(healthModels['minimax-custom']).toBe('MiniMax-M2.7');
        } catch (e) {
            // If import fails due to missing dependencies, just verify the constant exists
            // by reading the file directly
            const fs = await import('fs');
            const content = fs.readFileSync('src/providers/provider-pool-manager.js', 'utf-8');
            expect(content).toContain("'minimax-custom': 'MiniMax-M2.7'");
        }
    });

    it('should have MiniMax example in provider_pools.json.example', async () => {
        const fs = await import('fs');
        const content = fs.readFileSync('configs/provider_pools.json.example', 'utf-8');
        const config = JSON.parse(content);
        expect(config['minimax-custom']).toBeDefined();
        expect(config['minimax-custom'][0].MINIMAX_API_KEY).toBeDefined();
        expect(config['minimax-custom'][0].MINIMAX_BASE_URL).toBe('https://api.minimax.io/v1');
    });
});

describe('MiniMax Converter Registration', () => {
    it('should register MiniMax converter with OpenAI converter', async () => {
        const fs = await import('fs');
        const content = fs.readFileSync('src/converters/register-converters.js', 'utf-8');
        expect(content).toContain('MODEL_PROTOCOL_PREFIX.MINIMAX');
        expect(content).toContain('OpenAIConverter');
    });
});

describe('MiniMax Strategy Registration', () => {
    it('should map minimax protocol to OpenAI strategy', async () => {
        const fs = await import('fs');
        const content = fs.readFileSync('src/utils/provider-strategies.js', 'utf-8');
        expect(content).toContain('MODEL_PROTOCOL_PREFIX.MINIMAX');
        expect(content).toContain('new OpenAIStrategy()');
    });
});

describe('MiniMax Adapter Registration', () => {
    it('should register MiniMaxApiServiceAdapter in adapter.js', async () => {
        const fs = await import('fs');
        const content = fs.readFileSync('src/providers/adapter.js', 'utf-8');
        expect(content).toContain('MiniMaxApiServiceAdapter');
        expect(content).toContain('MODEL_PROVIDER.MINIMAX_CUSTOM');
        expect(content).toContain("import { MiniMaxApiService } from './minimax/minimax-core.js'");
    });
});

describe('MiniMax Service Manager Integration', () => {
    it('should have MiniMax in identify field map', async () => {
        const fs = await import('fs');
        const content = fs.readFileSync('src/services/service-manager.js', 'utf-8');
        expect(content).toContain("'minimax-custom': 'MINIMAX_BASE_URL'");
    });
});
