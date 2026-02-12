import crypto from 'crypto';
import { jest } from '@jest/globals';
import logger from '../src/utils/logger.js';
jest.mock('../src/services/service-manager.js', () => ({
    getProviderPoolManager: () => null
}));
import { KiroApiService } from '../src/providers/claude/claude-kiro.js';

function applyCredentialStub(service, overrides = {}) {
    service.loadCredentials = jest.fn(async function loadCredentialsStub() {
        this.region = this.region || 'us-east-1';
        this.idcRegion = this.idcRegion || this.region;
        this.baseUrl = this.baseUrl || `https://q.${this.region}.amazonaws.com/generateAssistantResponse`;
        this.accessToken = this.accessToken || 'test-access-token';
        Object.assign(this, overrides);
    });
}

function createService(config = {}, credentialOverrides = {}) {
    const service = new KiroApiService({
        uuid: 'kiro-test-node-001',
        ...config
    });
    applyCredentialStub(service, credentialOverrides);
    return service;
}

describe('Kiro machineId resolution and header consistency', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('uses explicit machineId from provider config in callApi headers', async () => {
        const service = createService(
            { machineId: 'cfg-machine-id-0001' },
            { _credentialMachineIdRaw: 'creds-machine-id-should-not-win' }
        );
        await service.initialize();

        service.buildCodewhispererRequest = jest.fn().mockResolvedValue({ conversationState: {} });
        service.axiosInstance = {
            post: jest.fn().mockResolvedValue({ data: { ok: true } })
        };

        await service.callApi('', 'claude-sonnet-4-5', {
            messages: [{ role: 'user', content: 'hello' }]
        });

        const headers = service.axiosInstance.post.mock.calls[0][2].headers;
        expect(headers['x-amz-user-agent']).toContain('cfg-machine-id-0001');
        expect(headers['user-agent']).toContain('cfg-machine-id-0001');
        expect(service.machineIdSource).toBe('config');
    });

    test('uses credential-file machineId when config machineId is absent (stream path)', async () => {
        const service = createService({}, { _credentialMachineIdRaw: 'creds-machine-id-0002' });
        await service.initialize();

        service.buildCodewhispererRequest = jest.fn().mockResolvedValue({ conversationState: {} });
        const stream = {
            destroy: jest.fn(),
            async *[Symbol.asyncIterator]() {}
        };
        service.axiosInstance = {
            post: jest.fn().mockResolvedValue({ data: stream })
        };

        const chunks = [];
        for await (const chunk of service.streamApiReal('', 'claude-sonnet-4-5', {
            messages: [{ role: 'user', content: 'hello' }]
        })) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(0);
        const headers = service.axiosInstance.post.mock.calls[0][2].headers;
        expect(headers['x-amz-user-agent']).toContain('creds-machine-id-0002');
        expect(headers['user-agent']).toContain('creds-machine-id-0002');
        expect(service.machineIdSource).toBe('creds');
    });

    test('falls back to derived machineId when config and credential values are absent (usage path)', async () => {
        const nodeUuid = 'kiro-test-node-derived';
        const service = createService(
            {
                uuid: nodeUuid
            },
            {
                clientId: 'client-id-for-derived-path'
            }
        );
        await service.initialize();

        service.axiosInstance = {
            get: jest.fn().mockResolvedValue({ data: { success: true } })
        };

        await service.getUsageLimits();

        const expectedMachineId = crypto.createHash('sha256').update(nodeUuid).digest('hex');
        const headers = service.axiosInstance.get.mock.calls[0][1].headers;
        expect(headers['x-amz-user-agent']).toContain(expectedMachineId);
        expect(headers['user-agent']).toContain(expectedMachineId);
        expect(service.machineIdSource).toBe('derived');
    });

    test('invalid configured machineId falls back safely with warning', async () => {
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        const service = createService(
            { machineId: 'invalid machine id with spaces' },
            { _credentialMachineIdRaw: 'creds-machine-id-0004' }
        );
        await service.initialize();

        service.buildCodewhispererRequest = jest.fn().mockResolvedValue({ conversationState: {} });
        service.axiosInstance = {
            post: jest.fn().mockResolvedValue({ data: { ok: true } })
        };

        await service.callApi('', 'claude-sonnet-4-5', {
            messages: [{ role: 'user', content: 'hello' }]
        });

        const headers = service.axiosInstance.post.mock.calls[0][2].headers;
        expect(headers['x-amz-user-agent']).toContain('creds-machine-id-0004');
        expect(service.machineIdSource).toBe('creds');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ignoring invalid machineId from config'));
    });
});
