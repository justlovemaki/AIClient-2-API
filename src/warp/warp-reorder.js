/**
 * Warp API Message Reordering
 * Adapted from Python protobuf2openai/reorder.py
 * 
 * Reorders messages for Anthropic-style conversation flow.
 */

import { normalizeContentToList, segmentsToText } from './warp-utils.js';

/**
 * Reorder messages for Anthropic-style conversation flow
 * 
 * This function:
 * 1. Expands multi-segment user messages into separate messages
 * 2. Splits assistant messages with multiple tool calls
 * 3. Reorders tool results to follow their corresponding tool calls
 * 4. Handles trailing assistant messages with tool calls
 */
function reorderMessagesForAnthropic(history) {
    if (!history || history.length === 0) {
        return [];
    }

    // Step 1: Expand messages
    const expanded = [];
    for (const m of history) {
        if (m.role === 'user') {
            const items = normalizeContentToList(m.content);
            if (Array.isArray(m.content) && items.length > 1) {
                for (const seg of items) {
                    if (typeof seg === 'object' && seg !== null && seg.type === 'text' && typeof seg.text === 'string') {
                        expanded.push({ role: 'user', content: seg.text });
                    } else {
                        expanded.push({ 
                            role: 'user', 
                            content: typeof seg === 'object' ? [seg] : seg 
                        });
                    }
                }
            } else {
                expanded.push(m);
            }
        } else if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 1) {
            const assistantText = segmentsToText(normalizeContentToList(m.content));
            if (assistantText) {
                expanded.push({ role: 'assistant', content: assistantText });
            }
            for (const tc of (m.tool_calls || [])) {
                expanded.push({ 
                    role: 'assistant', 
                    content: null, 
                    tool_calls: [tc] 
                });
            }
        } else {
            expanded.push(m);
        }
    }

    // Step 2: Find last input message (user or tool)
    let lastInputToolId = null;
    let lastInputIsTool = false;
    for (let i = expanded.length - 1; i >= 0; i--) {
        const m = expanded[i];
        if (m.role === 'tool' && m.tool_call_id) {
            lastInputToolId = m.tool_call_id;
            lastInputIsTool = true;
            break;
        }
        if (m.role === 'user') {
            break;
        }
    }

    // Step 3: Build tool results map and assistant tool call IDs set
    const toolResultsById = {};
    const assistantTcIds = new Set();
    
    for (const m of expanded) {
        if (m.role === 'tool' && m.tool_call_id && !toolResultsById[m.tool_call_id]) {
            toolResultsById[m.tool_call_id] = m;
        }
        if (m.role === 'assistant' && m.tool_calls) {
            try {
                for (const tc of (m.tool_calls || [])) {
                    const id = (tc || {}).id;
                    if (typeof id === 'string' && id) {
                        assistantTcIds.add(id);
                    }
                }
            } catch (e) {
                // Ignore errors
            }
        }
    }

    // Step 4: Reorder messages
    const result = [];
    let trailingAssistantMsg = null;

    for (const m of expanded) {
        // Handle tool messages
        if (m.role === 'tool') {
            // Preserve unmatched tool results inline
            if (!m.tool_call_id || !assistantTcIds.has(m.tool_call_id)) {
                result.push(m);
                if (m.tool_call_id) {
                    delete toolResultsById[m.tool_call_id];
                }
            }
            continue;
        }

        // Handle assistant messages with tool calls
        if (m.role === 'assistant' && m.tool_calls) {
            const ids = [];
            try {
                for (const tc of (m.tool_calls || [])) {
                    const id = (tc || {}).id;
                    if (typeof id === 'string' && id) {
                        ids.push(id);
                    }
                }
            } catch (e) {
                // Ignore errors
            }

            // If this is the trailing assistant message with the last input tool call
            if (lastInputIsTool && lastInputToolId && ids.includes(lastInputToolId)) {
                if (trailingAssistantMsg === null) {
                    trailingAssistantMsg = m;
                }
                continue;
            }

            // Add assistant message and its tool results
            result.push(m);
            for (const id of ids) {
                const tr = toolResultsById[id];
                if (tr) {
                    result.push(tr);
                    delete toolResultsById[id];
                }
            }
            continue;
        }

        // Add other messages as-is
        result.push(m);
    }

    // Step 5: Append trailing assistant message and its tool result
    if (lastInputIsTool && lastInputToolId && trailingAssistantMsg !== null) {
        result.push(trailingAssistantMsg);
        const tr = toolResultsById[lastInputToolId];
        if (tr) {
            result.push(tr);
            delete toolResultsById[lastInputToolId];
        }
    }

    return result;
}

export {
    reorderMessagesForAnthropic
};
