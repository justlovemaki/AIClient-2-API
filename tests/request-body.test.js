import { describe, expect, jest, test } from '@jest/globals';
import { EventEmitter } from 'events';
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
        const req = new EventEmitter();
        req.destroy = jest.fn();
        const promise = getRequestBody(req, { maxBytes: 8 });

        req.emit('data', Buffer.from('{"payload":"too-large"}'));
        req.emit('end');

        await expect(promise).rejects.toMatchObject({
            statusCode: 413
        });
        expect(req.destroy).not.toHaveBeenCalled();
    });
});
