/**
 * @file Warp API Utility Functions
 * @description Shared utility functions for content normalization and text extraction.
 * Centralized to avoid code duplication across warp-packet-builder.js and warp-reorder.js.
 */

/**
 * Normalize content to list format
 * Handles string, array, and object content types
 */
function normalizeContentToList(content) {
    const segments = [];
    
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }
    
    if (Array.isArray(content)) {
        for (const item of content) {
            if (typeof item === 'object' && item !== null) {
                const t = item.type || (typeof item.text === 'string' ? 'text' : null);
                if (t === 'text' && typeof item.text === 'string') {
                    segments.push({ type: 'text', text: item.text });
                } else {
                    const seg = {};
                    if (t) seg.type = t;
                    if (typeof item.text === 'string') seg.text = item.text;
                    if (Object.keys(seg).length > 0) segments.push(seg);
                }
            }
        }
        return segments;
    }
    
    if (typeof content === 'object' && content !== null) {
        if (typeof content.text === 'string') {
            return [{ type: 'text', text: content.text }];
        }
    }
    
    return [];
}

/**
 * Convert segments to plain text
 * Extracts text from content segments
 */
function segmentsToText(segments) {
    const parts = [];
    for (const seg of segments) {
        if (typeof seg === 'object' && seg !== null && seg.type === 'text' && typeof seg.text === 'string') {
            parts.push(seg.text || '');
        }
    }
    return parts.join('');
}

/**
 * Convert segments to Warp results format
 */
function segmentsToWarpResults(segments) {
    const results = [];
    for (const seg of segments) {
        if (seg.type === 'text' && seg.text) {
            results.push({
                text: { text: seg.text }
            });
        } else if (typeof seg === 'string') {
            results.push({
                text: { text: seg }
            });
        }
    }
    return results;
}

export {
    normalizeContentToList,
    segmentsToText,
    segmentsToWarpResults
};
