import { jest } from '@jest/globals';

// Mock `open` module before importing anything that uses it
jest.mock('open', () => ({
    default: jest.fn()
}));

// Now import the module under test
import { createRequestHandler } from '../src/request-handler.js';

describe('CORS Configuration', () => {
    let mockConfig;
    let mockProviderPoolManager;
    let handler;

    beforeEach(() => {
        mockConfig = {
            MODEL_PROVIDER: 'mock-provider',
            REQUIRED_API_KEY: 'mock-key',
            providerPools: {}
        };

        mockProviderPoolManager = {
            getPool: () => null
        };

        handler = createRequestHandler(mockConfig, mockProviderPoolManager);
    });

    test('should set CORS headers for POST requests', async () => {
        const headers = {};
        const req = {
            url: '/v1/test',
            method: 'POST',
            headers: {
                host: 'localhost:3000'
            }
        };

        const res = {
            setHeader: (name, value) => {
                headers[name] = value;
            },
            writeHead: (statusCode, h) => {
                if (h) Object.assign(headers, h);
            },
            end: () => {}
        };

        try {
            await handler(req, res);
        } catch (e) {
            // Expected to fail/error due to mock environment, but headers should be set
        }

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
        expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
        expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, x-goog-api-key, Model-Provider');
    });

    test('should set CORS headers for OPTIONS requests', async () => {
        const headers = {};
        const req = {
            url: '/v1/test',
            method: 'OPTIONS',
            headers: {
                host: 'localhost:3000'
            }
        };

        const res = {
            setHeader: (name, value) => {
                headers[name] = value;
            },
            writeHead: (statusCode, h) => {
                if (h) Object.assign(headers, h);
            },
            end: () => {}
        };

        try {
            await handler(req, res);
        } catch (e) {
             // Expected
        }

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
        expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
        expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, x-goog-api-key, Model-Provider');
    });
});
