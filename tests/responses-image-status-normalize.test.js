import { normalizeResponsesImageGenerationStatus } from '../src/utils/common.js';

describe('Responses image generation status normalization', () => {
    test('marks completed response output image calls with result as completed', () => {
        const response = normalizeResponsesImageGenerationStatus({
            id: 'resp_1',
            status: 'completed',
            output: [{
                id: 'ig_1',
                type: 'image_generation_call',
                status: 'generating',
                result: 'iVBORw0KGgo=',
                output_format: 'png'
            }]
        });

        expect(response.output[0]).toMatchObject({
            id: 'ig_1',
            type: 'image_generation_call',
            status: 'completed',
            result: 'iVBORw0KGgo='
        });
    });

    test('marks stream terminal image items with result as completed', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.output_item.done',
            output_index: 0,
            item: {
                id: 'ig_1',
                type: 'image_generation_call',
                status: 'generating',
                result: 'iVBORw0KGgo='
            }
        });

        expect(event.item.status).toBe('completed');
    });

    test('marks completed event output image calls with result as completed', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.completed',
            response: {
                id: 'resp_1',
                status: 'completed',
                output: [{
                    id: 'ig_1',
                    type: 'image_generation_call',
                    status: 'generating',
                    result: 'iVBORw0KGgo='
                }]
            }
        });

        expect(event.response.output[0].status).toBe('completed');
    });

    test('does not mark in-progress image calls without result as completed', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
                id: 'ig_1',
                type: 'image_generation_call',
                status: 'in_progress'
            }
        });

        expect(event.item.status).toBe('in_progress');
    });

    test('does not mark non-terminal stream image items as completed even with a result', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
                id: 'ig_1',
                type: 'image_generation_call',
                status: 'in_progress',
                result: 'partial-or-provider-specific-value'
            }
        });

        expect(event.item.status).toBe('in_progress');
    });

    test('does not mark non-completed response output image calls as completed', () => {
        const response = normalizeResponsesImageGenerationStatus({
            id: 'resp_1',
            status: 'in_progress',
            output: [{
                id: 'ig_1',
                type: 'image_generation_call',
                status: 'in_progress',
                result: 'partial-or-provider-specific-value'
            }]
        });

        expect(response.output[0].status).toBe('in_progress');
    });

    test('preserves failed image calls even when a terminal payload includes a result', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.completed',
            response: {
                id: 'resp_1',
                status: 'completed',
                output: [{
                    id: 'ig_1',
                    type: 'image_generation_call',
                    status: 'failed',
                    result: 'provider-error-or-debug-payload'
                }]
            }
        });

        expect(event.response.output[0].status).toBe('failed');
    });

    test('marks terminal image calls without a status but with result as completed', () => {
        const event = normalizeResponsesImageGenerationStatus({
            type: 'response.output_item.done',
            output_index: 0,
            item: {
                id: 'ig_1',
                type: 'image_generation_call',
                result: 'iVBORw0KGgo='
            }
        });

        expect(event.item.status).toBe('completed');
    });
});
