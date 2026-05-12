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
});
