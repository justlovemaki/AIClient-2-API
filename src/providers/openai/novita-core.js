import { OpenAIApiService } from './openai-core.js';
import { getProviderModels } from '../provider-models.js';
import { MODEL_PROVIDER } from '../../utils/common.js';
import logger from '../../utils/logger.js';

const DEFAULT_NOVITA_BASE_URL = 'https://api.novita.ai/openai';

// Novita AI API service — OpenAI-compatible endpoint
export class NovitaApiService extends OpenAIApiService {
    constructor(config) {
        if (!config.NOVITA_API_KEY && !config.OPENAI_API_KEY) {
            throw new Error("Novita API Key (NOVITA_API_KEY) is required for NovitaApiService.");
        }
        const mappedConfig = {
            ...config,
            OPENAI_API_KEY: config.NOVITA_API_KEY || config.OPENAI_API_KEY,
            OPENAI_BASE_URL: config.NOVITA_BASE_URL || config.OPENAI_BASE_URL || DEFAULT_NOVITA_BASE_URL,
        };
        super(mappedConfig);
        logger.info(`[Novita] Initialized with base URL: ${mappedConfig.OPENAI_BASE_URL}`);
    }

    async listModels() {
        const models = getProviderModels(MODEL_PROVIDER.NOVITA_CUSTOM);
        return {
            object: 'list',
            data: models.map(id => ({
                id,
                object: 'model',
                created: 1677610602,
                owned_by: 'novita-ai',
            })),
        };
    }
}
