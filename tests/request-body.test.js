import { describe, expect, test } from '@jest/globals';
import { Readable } from 'stream';
import { getRequestBody } from '../src/utils/common.js';

function makeRequest(chunks) {
    return Readable.from(chunks);
}

describe('getRequestBody', () => {
    test('parses JSON when body is within optional maxBytes limit', async () => {
        await expect(
            getRequestBody(makeRequest(['{"ok":true}']), { maxBytes: 32 })
        ).resolves.toEqual({ ok: true });
    });

    test('rejects JSON bodies that exceed optional maxBytes limit', async () => {
        await expect(
            getRequestBody(makeRequest(['{"payload":"too-large"}']), { maxBytes: 8 })
        ).rejects.toMatchObject({
            statusCode: 413
        });
    });
});
