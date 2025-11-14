/**
 * @file Warp API Model Configuration and Catalog
 * @description Provides model definitions, configurations, and OpenAI compatibility mappings for Warp API.
 * Contains comprehensive model catalog with support for agent, planning, and coding categories.
 * All models use consistent configuration: base model + o3 planning + auto coding.
 */

/**
 * Get model configuration
 * All models use the same pattern: base model + o3 planning + auto coding
 */
function getModelConfig(modelName) {
    // Known models that map directly
    const knownModels = new Set([
        'claude-4-sonnet', 'claude-4-opus', 'claude-4.1-opus',
        'gpt-5', 'gpt-4o', 'gpt-4.1', 'o3', 'o4-mini',
        'gemini-2.5-pro', 'warp-basic'
    ]);

    const normalizedName = modelName.toLowerCase().trim();

    // Use the model name directly if it's known, otherwise use "auto"
    const baseModel = knownModels.has(normalizedName) ? normalizedName : 'auto';

    return {
        base: baseModel,
        planning: 'o3',  // Always use o3 for planning
        coding: 'auto'
    };
}

/**
 * Get comprehensive list of Warp AI models from packet analysis
 */
function getWarpModels() {
    return {
        agent_mode: {
            default: 'auto',
            models: [
                {
                    id: 'auto',
                    display_name: 'auto',
                    description: 'claude 4 sonnet',
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'warp-basic',
                    display_name: 'lite',
                    description: 'basic model',
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'gpt-5',
                    display_name: 'gpt-5',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'claude-4-sonnet',
                    display_name: 'claude 4 sonnet',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'claude-4-opus',
                    display_name: 'claude 4 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'claude-4.1-opus',
                    display_name: 'claude 4.1 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'gpt-4o',
                    display_name: 'gpt-4o',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'gpt-4.1',
                    display_name: 'gpt-4.1',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'o4-mini',
                    display_name: 'o4-mini',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'o3',
                    display_name: 'o3',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                },
                {
                    id: 'gemini-2.5-pro',
                    display_name: 'gemini 2.5 pro',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'agent'
                }
            ]
        },
        planning: {
            default: 'o3',
            models: [
                {
                    id: 'warp-basic',
                    display_name: 'lite',
                    description: 'basic model',
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'gpt-5 (high reasoning)',
                    display_name: 'gpt-5',
                    description: 'high reasoning',
                    vision_supported: false,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'claude-4-opus',
                    display_name: 'claude 4 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'claude-4.1-opus',
                    display_name: 'claude 4.1 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'gpt-4.1',
                    display_name: 'gpt-4.1',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'o4-mini',
                    display_name: 'o4-mini',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                },
                {
                    id: 'o3',
                    display_name: 'o3',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'planning'
                }
            ]
        },
        coding: {
            default: 'auto',
            models: [
                {
                    id: 'auto',
                    display_name: 'auto',
                    description: 'claude 4 sonnet',
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'warp-basic',
                    display_name: 'lite',
                    description: 'basic model',
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'gpt-5',
                    display_name: 'gpt-5',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'claude-4-sonnet',
                    display_name: 'claude 4 sonnet',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'claude-4-opus',
                    display_name: 'claude 4 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'claude-4.1-opus',
                    display_name: 'claude 4.1 opus',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'gpt-4o',
                    display_name: 'gpt-4o',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'gpt-4.1',
                    display_name: 'gpt-4.1',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'o4-mini',
                    display_name: 'o4-mini',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'o3',
                    display_name: 'o3',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                },
                {
                    id: 'gemini-2.5-pro',
                    display_name: 'gemini 2.5 pro',
                    description: null,
                    vision_supported: true,
                    usage_multiplier: 1,
                    category: 'coding'
                }
            ]
        }
    };
}

/**
 * Get all unique models across all categories for OpenAI API compatibility
 */
function getAllUniqueModels() {
    try {
        const modelsData = getWarpModels();
        const uniqueModels = {};

        // Collect all unique models across categories
        for (const categoryData of Object.values(modelsData)) {
            for (const model of categoryData.models) {
                const modelId = model.id;
                
                if (!(modelId in uniqueModels)) {
                    // Create OpenAI-compatible model entry
                    uniqueModels[modelId] = {
                        id: modelId,
                        object: 'model',
                        created: Math.floor(Date.now() / 1000),
                        owned_by: 'warp',
                        display_name: model.display_name,
                        description: model.description || model.display_name,
                        vision_supported: model.vision_supported,
                        usage_multiplier: model.usage_multiplier,
                        categories: [model.category]
                    };
                } else {
                    // Add category if model appears in multiple categories
                    if (!uniqueModels[modelId].categories.includes(model.category)) {
                        uniqueModels[modelId].categories.push(model.category);
                    }
                }
            }
        }

        return Object.values(uniqueModels);
    } catch (error) {
        // Fallback to simple model list
        return [
            {
                id: 'auto',
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'warp',
                display_name: 'auto',
                description: 'Auto-select best model'
            }
        ];
    }
}

/**
 * Get models by category
 */
function getModelsByCategory(category) {
    const modelsData = getWarpModels();
    return modelsData[category] || { default: 'auto', models: [] };
}

/**
 * Check if model exists
 */
function isValidModel(modelId) {
    const allModels = getAllUniqueModels();
    return allModels.some(model => model.id === modelId);
}

/**
 * Get model by ID
 */
function getModelById(modelId) {
    const allModels = getAllUniqueModels();
    return allModels.find(model => model.id === modelId) || null;
}

export {
    getModelConfig,
    getWarpModels,
    getAllUniqueModels,
    getModelsByCategory,
    isValidModel,
    getModelById
};
