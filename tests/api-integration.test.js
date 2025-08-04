import { fetch } from 'undici';

/**
 * HTTP Integration Tests for API Server
 * 
 * This test suite makes actual HTTP requests to a running server instance
 * instead of directly calling the program code. This provides true integration testing.
 * 
 * Configuration:
 * - TEST_SERVER_BASE_URL: The base URL of the running server
 * - TEST_API_KEY: The API key to use for authentication (should match server config)
 * 
 * Each test can include custom headers to test different scenarios.
 * Make sure the server is running at the specified URL before running tests.
 */

// Test server configuration
const TEST_SERVER_BASE_URL = 'http://192.168.1.232:3000';
const TEST_API_KEY = '123456'; // You may need to adjust this based on your server config
const MODEL_PROVIDER = {
    // Model provider constants
    GEMINI_CLI: 'gemini-cli-oauth',
    OPENAI_CUSTOM: 'openai-custom',
    CLAUDE_CUSTOM: 'claude-custom',
    KIRO_API: 'claude-kiro-oauth',
}

// Real test data for different API formats
const REAL_TEST_DATA = {
    openai: {
        nonStreamRequest: {
            model: "gemini-2.5-flash",
            messages: [
                { role: "user", content: "Hello, what is 2+2?" }
            ]
        },
        streamRequest: {
            model: "gemini-2.5-flash", 
            messages: [
                { role: "user", content: "Hello, what is 2+2?" }
            ],
            stream: true
        }
    },
    gemini: {
        nonStreamRequest: {
            contents: [
                { 
                    role: "user",
                    parts: [{ text: "Hello, what is 2+2?" }] 
                }
            ]
        },
        streamRequest: {
            contents: [
                { 
                    role: "user",
                    parts: [{ text: "Hello, what is 2+2?" }] 
                }
            ]
        }
    },
    claude: {
        nonStreamRequest: {
            model: "claude-opus-4-20250514",
            messages: [
                { role: "user", content: "Hello, what is 2+2?" }
            ]
        },
        streamRequest: {
            model: "claude-opus-4-20250514",
            messages: [
                { role: "user", content: "Hello, what is 2+2?" }
            ],
            stream: true
        }
    }
};

// To run all integration tests:
// npx jest ./tests/api-integration.test.js
describe('API Integration Tests with HTTP Requests', () => {
    beforeAll(async () => {
        // Test server connectivity
        try {
            const healthResponse = await fetch(`${TEST_SERVER_BASE_URL}/health`);
            const healthData = await healthResponse.json();
            console.log('✓ Server is accessible:', healthData);
        } catch (error) {
            console.warn('⚠ Failed to connect to server:', error.message);
            console.log('  Make sure the server is running at', TEST_SERVER_BASE_URL);
        }
    }, 30000); // Set a higher timeout for beforeAll

    afterAll(() => {
        // Jest handles test results summary automatically
    });

    // To run all OpenAI Compatible Endpoints tests:
    // npx jest ./tests/api-integration.test.js -t "OpenAI Compatible Endpoints"
    describe('OpenAI Compatible Endpoints', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions non-streaming Gemini"
        test('OpenAI /v1/chat/completions non-streaming Gemini', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI },
                REAL_TEST_DATA.openai.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('choices');
            expect(Array.isArray(responseData.choices)).toBe(true);
            expect(responseData.choices.length).toBeGreaterThan(0);
            expect(responseData.choices[0]).toHaveProperty('message');
            expect(responseData.choices[0].message).toHaveProperty('content');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions streaming Gemini"
        test('OpenAI /v1/chat/completions streaming Gemini', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI },
                REAL_TEST_DATA.openai.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions non-streaming with OpenAI provider"
        test('OpenAI /v1/chat/completions non-streaming with OpenAI provider', async () => {
            REAL_TEST_DATA.openai.nonStreamRequest.model = "deepseek-ai/DeepSeek-V3";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.OPENAI_CUSTOM },
                REAL_TEST_DATA.openai.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('choices');
            expect(Array.isArray(responseData.choices)).toBe(true);
            expect(responseData.choices.length).toBeGreaterThan(0);
            expect(responseData.choices[0]).toHaveProperty('message');
            expect(responseData.choices[0].message).toHaveProperty('content');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions streaming with OpenAI provider"
        test('OpenAI /v1/chat/completions streaming with OpenAI provider', async () => {
            REAL_TEST_DATA.openai.streamRequest.model = "deepseek-ai/DeepSeek-V3";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.OPENAI_CUSTOM },
                REAL_TEST_DATA.openai.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions non-streaming with Claude provider"
        test('OpenAI /v1/chat/completions non-streaming with Claude provider', async () => {
            REAL_TEST_DATA.openai.nonStreamRequest.model = "claude-4-sonnet";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.CLAUDE_CUSTOM },
                REAL_TEST_DATA.claude.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('choices');
            expect(Array.isArray(responseData.choices)).toBe(true);
            expect(responseData.choices.length).toBeGreaterThan(0);
            expect(responseData.choices[0]).toHaveProperty('message');
            expect(responseData.choices[0].message).toHaveProperty('content');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/chat/completions streaming with Claude provider"
        test('OpenAI /v1/chat/completions streaming with Claude provider', async () => {
            REAL_TEST_DATA.openai.nonStreamRequest.model = "claude-4-sonnet";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.CLAUDE_CUSTOM },
                REAL_TEST_DATA.claude.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });
    });

    // To run all Claude Native Endpoints tests:
    // npx jest ./tests/api-integration.test.js -t "Claude Native Endpoints"
    describe('Claude Native Endpoints', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Claude /v1/messages non-streaming"
        test('Claude /v1/messages non-streaming', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/messages`,
                'POST',
                'anthropic',
                { 'model-provider': MODEL_PROVIDER.CLAUDE_CUSTOM },
                REAL_TEST_DATA.claude.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('content');
            expect(Array.isArray(responseData.content)).toBe(true);
            expect(responseData.content.length).toBeGreaterThan(0);
            expect(responseData.content[0]).toHaveProperty('text');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Claude /v1/messages streaming"
        test('Claude /v1/messages streaming', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/messages`,
                'POST',
                'anthropic',
                { 'model-provider': MODEL_PROVIDER.CLAUDE_CUSTOM },
                REAL_TEST_DATA.claude.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });
    });

    // To run all Claude Kiro Endpoints tests:
    // npx jest ./tests/api-integration.test.js -t "Claude Kiro Endpoints"
    describe('Claude Kiro Endpoints', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Claude Kiro /v1/messages non-streaming"
        test('Claude Kiro /v1/messages non-streaming', async () => {
            REAL_TEST_DATA.claude.nonStreamRequest.model = "claude-4-sonnet";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/messages`,
                'POST',
                'anthropic',
                { 'model-provider': MODEL_PROVIDER.KIRO_API },
                REAL_TEST_DATA.claude.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('content');
            expect(Array.isArray(responseData.content)).toBe(true);
            expect(responseData.content.length).toBeGreaterThan(0);
            expect(responseData.content[0]).toHaveProperty('text');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Claude Kiro /v1/messages streaming"
        test('Claude Kiro /v1/messages streaming', async () => {
            REAL_TEST_DATA.claude.streamRequest.model = "claude-4-sonnet";
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/messages`,
                'POST',
                'anthropic',
                { 'model-provider': MODEL_PROVIDER.KIRO_API },
                REAL_TEST_DATA.claude.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });
    });


    // To run all Gemini Native Endpoints tests:
    // npx jest ./tests/api-integration.test.js -t "Gemini Native Endpoints"
    describe('Gemini Native Endpoints', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Gemini /v1beta/models/{model}:generateContent"
        test('Gemini /v1beta/models/{model}:generateContent', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1beta/models/gemini-2.5-flash:generateContent`,
                'POST',
                'goog',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI },
                REAL_TEST_DATA.gemini.nonStreamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('candidates');
            expect(Array.isArray(responseData.candidates)).toBe(true);
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Gemini /v1beta/models/{model}:streamGenerateContent"
        test('Gemini /v1beta/models/{model}:streamGenerateContent', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1beta/models/gemini-2.5-flash:streamGenerateContent`,
                'POST',
                'goog',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI },
                REAL_TEST_DATA.gemini.streamRequest
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('connection')).toBe('keep-alive');
            
            // Read some of the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunks = [];
            let chunkCount = 0;
            
            try {
                while (chunkCount < 3) { // Read first few chunks
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    chunks.push(chunk);
                    chunkCount++;
                }
            } finally {
                reader.releaseLock();
            }
            
            expect(chunks.length).toBeGreaterThan(0);
        });
    });

    // To run all Model List Endpoints tests:
    // npx jest ./tests/api-integration.test.js -t "Model List Endpoints"
    describe('Model List Endpoints', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/models Gemini"
        test('OpenAI /v1/models Gemini', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('data');
            expect(Array.isArray(responseData.data)).toBe(true);
        });

        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/models OpenAI"
        test('OpenAI /v1/models OpenAI', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.OPENAI_CUSTOM }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('data');
            expect(Array.isArray(responseData.data)).toBe(true);
        });

        // npx jest ./tests/api-integration.test.js -t "OpenAI /v1/models Claude"
        test('OpenAI /v1/models Claude', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'bearer',
                { 'model-provider': MODEL_PROVIDER.CLAUDE_CUSTOM }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('data');
            expect(Array.isArray(responseData.data)).toBe(true);
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Gemini /v1beta/models modelList"
        test('Gemini /v1beta/models modelList', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1beta/models`,
                'GET',
                'goog',
                { 'model-provider': MODEL_PROVIDER.GEMINI_CLI }
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('models');
            expect(Array.isArray(responseData.models)).toBe(true);
        });
    });

    // To run all Authentication Tests:
    // npx jest ./tests/api-integration.test.js -t "Authentication Tests API KEY"
    describe('Authentication Tests API KEY', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Reject requests without API key"
        test('Reject requests without API key', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'none',
                {},
                {}
            );

            expect(response.status).toBe(401);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('error');
            expect(responseData.error.message).toContain('Unauthorized');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Accept query parameter authentication"
        test('Accept query parameter authentication', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'query'
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Accept Bearer token authentication"
        test('Accept Bearer token authentication', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'bearer'
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Accept x-goog-api-key authentication"
        test('Accept x-goog-api-key authentication', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'goog'
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Accept x-api-key authentication for Claude"
        test('Accept x-api-key authentication for Claude', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'GET',
                'anthropic'
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');
        });
    });

    // To run all Error Handling Tests:
    // npx jest ./tests/api-integration.test.js -t "Error Handling Tests"
    describe('Error Handling Tests', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Handle invalid JSON in request body"
        test('Handle invalid JSON in request body', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/chat/completions`,
                'POST',
                'bearer',
                {},
                'invalid json'
            );

            expect(response.status).toBe(500);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('error');
        });

        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "Handle unsupported endpoints"
        test('Handle unsupported endpoints', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/unsupported/endpoint`,
                'POST',
                'bearer',
                {},
                {}
            );

            expect(response.status).toBe(404);
            expect(response.headers.get('content-type')).toContain('application/json');
            
            const responseData = await response.json();
            expect(responseData).toHaveProperty('error');
            expect(responseData.error.message).toContain('Not Found');
        });
    });

    // To run all CORS Headers Test:
    // npx jest ./tests/api-integration.test.js -t "CORS Headers Test"
    describe('CORS Headers Test', () => {
        // To run this test:
        // npx jest ./tests/api-integration.test.js -t "CORS headers support"
        test('CORS headers support', async () => {
            const response = await makeRequest(
                `${TEST_SERVER_BASE_URL}/v1/models`,
                'OPTIONS',
                'none',
                {
                    'Origin': 'http://localhost:3000',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'Content-Type, Authorization'
                }
            );

            // CORS preflight should return 200 or 204
            expect([200, 204]).toContain(response.status);
        });
    });
});


// Helper function: Make a request with authentication and custom headers
async function makeRequest(url, method, authType = 'none', customHeaders = {}, body = null) {
    const headers = {
        'Content-Type': 'application/json',
        ...customHeaders
    };

    if (authType === 'bearer') {
        headers['Authorization'] = `Bearer ${TEST_API_KEY}`;
    } else if (authType === 'goog') {
        headers['x-goog-api-key'] = TEST_API_KEY;
    } else if (authType === 'anthropic') {
        headers['x-api-key'] = TEST_API_KEY;
    } else if (authType === 'query') {
        url = `${url}?key=${TEST_API_KEY}`;
    }

    const options = {
        method,
        headers
    };

    if (body) {
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    return await fetch(url, options);
}
