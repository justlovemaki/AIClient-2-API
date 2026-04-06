import { describe, expect, test } from '@jest/globals';
import {
    extractModelIdsFromNativeList,
    getConfiguredSupportedModels,
    normalizeModelIds,
    usesManagedModelList
} from '../src/providers/provider-models.js';

describe('provider-models helpers', () => {
    test('recognizes managed model list providers', () => {
        expect(usesManagedModelList('openai-custom')).toBe(true);
        expect(usesManagedModelList('openaiResponses-custom-lab')).toBe(true);
        expect(usesManagedModelList('gemini-cli-oauth')).toBe(false);
    });

    test('normalizes supported models for managed providers', () => {
        expect(getConfiguredSupportedModels('openai-custom', {
            supportedModels: [' gpt-4o-mini ', '', 'gpt-4o-mini', 'gpt-4.1']
        })).toEqual(['gpt-4.1', 'gpt-4o-mini']);

        expect(getConfiguredSupportedModels('gemini-cli-oauth', {
            supportedModels: ['gemini-2.5-flash']
        })).toEqual([]);
    });

    test('extracts model ids from openai-style model lists', () => {
        expect(extractModelIdsFromNativeList({
            data: [
                { id: 'gpt-4o-mini' },
                { id: 'gpt-4.1' }
            ]
        }, 'openai-custom')).toEqual(['gpt-4.1', 'gpt-4o-mini']);
    });

    test('normalizeModelIds handles edge cases', () => {
        // Empty array
        expect(normalizeModelIds([])).toEqual([]);
        // Non-array input
        expect(normalizeModelIds(null)).toEqual([]);
        expect(normalizeModelIds(undefined)).toEqual([]);
        expect(normalizeModelIds('not an array')).toEqual([]);
        // Mixed valid/invalid
        expect(normalizeModelIds(['gpt-4', null, undefined, '', '  gpt-4o  ', 'gpt-4'])).toEqual(['gpt-4', 'gpt-4o']);
        // Already sorted
        expect(normalizeModelIds(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    test('extracts model ids from different list shapes', () => {
        // Simple array of strings
        expect(extractModelIdsFromNativeList(['gpt-4o', 'gpt-4'], 'openai-custom'))
            .toEqual(['gpt-4', 'gpt-4o']);
        // Array with name field
        expect(extractModelIdsFromNativeList([
            { name: 'gpt-4o-mini' },
            { name: 'gpt-4.1' }
        ], 'openai-custom')).toEqual(['gpt-4.1', 'gpt-4o-mini']);
        // models field
        expect(extractModelIdsFromNativeList({
            models: [{ id: 'model-1' }, { id: 'model-2' }]
        }, 'openai-custom')).toEqual(['model-1', 'model-2']);
    });
});
