/**
 * Warp API Request Packet Builder
 * Adapted from Python protobuf2openai/packets.py
 * 
 * Builds Warp API request packets from OpenAI-compatible messages.
 */

import { v4 as uuidv4 } from 'uuid';
import { normalizeContentToList, segmentsToText, segmentsToWarpResults } from './warp-utils.js';

/**
 * Create a packet template with default settings
 */
function packetTemplate() {
    return {
        task_context: {
            tasks: [],
            active_task_id: ''
        },
        input: {
            context: {},
            user_inputs: {
                inputs: []
            }
        },
        settings: {
            model_config: {
                base: 'claude-4.1-opus',
                planning: 'o3',
                coding: 'auto'
            },
            rules_enabled: false,
            web_context_retrieval_enabled: false,
            supports_parallel_tool_calls: false,
            planning_enabled: false,
            warp_drive_context_enabled: false,
            supports_create_files: false,
            use_anthropic_text_editor_tools: false,
            supports_long_running_commands: false,
            should_preserve_file_content_in_history: false,
            supports_todos_ui: false,
            supports_linked_code_blocks: false,
            supported_tools: []
        },
        metadata: {
            logging: {
                is_autodetected_user_query: true,
                entrypoint: 'USER_INITIATED'
            }
        }
    };
}

// Restricted tools list - matching Python implementation
const RESTRICTED_TOOLS = [
    'read_files',
    'write_files',
    'list_files',
    'apply_file_diffs',
    'str_replace_editor',
    'search_files',
    'search_codebase',
    'suggest_plan',
    'suggest_create_plan',
    'grep',
    'file_glob',
    'file_glob_v2',
    'read_mcp_resource',
    'write_to_long_running_shell_command',
    'suggest_new_conversation',
    'ask_followup_question',
    'attempt_completion'
];

function getToolRestrictionsMessage() {
    const toolsStr = RESTRICTED_TOOLS.join(', ');
    return `I understand that I am not allowed to call certain internal tools including: ${toolsStr}. I will only use the tools provided through MCP. When using git diff or similar commands, I will check one file at a time to avoid execution issues.`;
}

function getToolRestrictionsText() {
    return `<ALERT>you are not allowed to call following tools:
${RESTRICTED_TOOLS.map(tool => `- \`${tool}\``).join('\n')}

IMPORTANT: When using git diff or similar commands to view file changes, always check ONE file at a time to avoid execution issues. Use separate commands for each file instead of passing multiple files to a single command.

Example:
- ✅ Good: git diff file1.py
- ✅ Good: git diff file2.py
- ❌ Avoid: git diff file1.py file2.py</ALERT>`;
}

/**
 * Map history messages to Warp format
 */
function mapHistoryToWarpMessages(history, taskId, toolMessageId, toolCallId, systemPromptForLastUser = null, attachToHistoryLastUser = false) {
    const msgs = [];

    // Insert server tool_call preamble as first message
    msgs.push({
        id: toolMessageId || uuidv4(),
        task_id: taskId,
        tool_call: {
            tool_call_id: toolCallId || uuidv4(),
            server: {
                payload: 'IgIQAQ=='
            }
        }
    });

    // Insert tool restrictions reminder at the beginning of history (matching Python implementation)
    // This ensures the model sees these restrictions when processing any request
    msgs.push({
        id: uuidv4(),
        task_id: taskId,
        agent_output: {
            text: getToolRestrictionsMessage()
        }
    });

    // Determine the last input message index (either last 'user' or last 'tool' with tool_call_id)
    let lastInputIndex = null;
    for (let idx = history.length - 1; idx >= 0; idx--) {
        const m = history[idx];
        if (m.role === 'user') {
            lastInputIndex = idx;
            break;
        }
        if (m.role === 'tool' && m.tool_call_id) {
            lastInputIndex = idx;
            break;
        }
    }

    for (let i = 0; i < history.length; i++) {
        const m = history[i];
        const mid = uuidv4();

        // Skip the final input message; it will be placed into input.user_inputs
        if (lastInputIndex !== null && i === lastInputIndex) {
            continue;
        }

        if (m.role === 'user') {
            const userQueryObj = {
                query: segmentsToText(normalizeContentToList(m.content))
            };
            msgs.push({
                id: mid,
                task_id: taskId,
                user_query: userQueryObj
            });
        } else if (m.role === 'assistant') {
            const assistantText = segmentsToText(normalizeContentToList(m.content));
            if (assistantText) {
                msgs.push({
                    id: mid,
                    task_id: taskId,
                    agent_output: {
                        text: assistantText
                    }
                });
            }

            // Handle tool calls
            const toolCalls = m.tool_calls || [];
            for (const tc of toolCalls) {
                const func = tc.function || {};
                let args = func.arguments || '{}';
                
                // Parse arguments if string
                if (typeof args === 'string') {
                    try {
                        args = JSON.parse(args);
                    } catch (e) {
                        args = {};
                    }
                }

                msgs.push({
                    id: uuidv4(),
                    task_id: taskId,
                    tool_call: {
                        tool_call_id: tc.id || uuidv4(),
                        call_mcp_tool: {
                            name: func.name || '',
                            args: args || {}
                        }
                    }
                });
            }
        } else if (m.role === 'tool') {
            // Preserve tool_result adjacency by placing it directly in task_context
            if (m.tool_call_id) {
                msgs.push({
                    id: uuidv4(),
                    task_id: taskId,
                    tool_call_result: {
                        tool_call_id: m.tool_call_id,
                        call_mcp_tool: {
                            success: {
                                results: segmentsToWarpResults(normalizeContentToList(m.content))
                            }
                        }
                    }
                });
            }
        }
    }

    return msgs;
}

/**
 * Attach user query and tools to packet inputs
 */
function attachUserAndToolsToInputs(packet, history, systemPromptText = null) {
    // Use the final post-reorder message as input (user or tool result)
    if (!history || history.length === 0) {
        throw new Error('post-reorder must contain at least one message');
    }

    const last = history[history.length - 1];

    if (last.role === 'user') {
        let queryText = segmentsToText(normalizeContentToList(last.content));

        // Check for empty query (matching Python implementation)
        if (!queryText || !queryText.trim()) {
            queryText = ' '; // Single space as minimal content
        }

        const userQueryPayload = {
            query: queryText
        };

        // Attach tool restrictions and system_prompt in referenced_attachments
        let referencedText = getToolRestrictionsText();
        if (systemPromptText) {
            referencedText += systemPromptText;
        }

        userQueryPayload.referenced_attachments = {
            SYSTEM_PROMPT: {
                plain_text: referencedText
            }
        };

        packet.input.user_inputs.inputs.push({
            user_query: userQueryPayload
        });
        return;
    }

    if (last.role === 'tool' && last.tool_call_id) {
        // Get tool results content (matching Python implementation)
        let toolResults = segmentsToWarpResults(normalizeContentToList(last.content));

        // Check if tool results are empty - some commands (like git add) normally have no output
        if (!toolResults || toolResults.length === 0) {
            // Provide minimal empty result to let Warp know the tool executed successfully but has no output
            toolResults = [{ text: { text: ' ' } }]; // Single space as minimal content
        }

        packet.input.user_inputs.inputs.push({
            tool_call_result: {
                tool_call_id: last.tool_call_id,
                call_mcp_tool: {
                    success: {
                        results: toolResults
                    }
                }
            }
        });
        return;
    }

    // If neither, throw error to catch protocol violations
    throw new Error('post-reorder last message must be user or tool result');
}

/**
 * Build complete Warp request packet from OpenAI messages
 */
function buildWarpPacket(messages, taskId, toolMessageId, toolCallId, modelConfig = null, systemPrompt = null, tools = null) {
    const packet = packetTemplate();
    
    // Set task ID
    packet.task_context.active_task_id = taskId;

    // Set model config if provided
    if (modelConfig) {
        packet.settings.model_config = {
            base: modelConfig.base || 'claude-4.1-opus',
            planning: modelConfig.planning || 'o3',
            coding: modelConfig.coding || 'auto'
        };
    }

    // Convert OpenAI tools to MCP context format (matching Python implementation)
    if (tools && Array.isArray(tools) && tools.length > 0) {
        const mcpTools = [];
        for (const tool of tools) {
            if (tool.type === 'function' && tool.function) {
                mcpTools.push({
                    name: tool.function.name,
                    description: tool.function.description || '',
                    input_schema: tool.function.parameters || {}
                });
            }
        }
        
        if (mcpTools.length > 0) {
            packet.mcp_context = {
                tools: mcpTools
            };
            console.log(`[Warp Packet] Added ${mcpTools.length} tools to mcp_context`);
        }
    }

    // Note: System prompt will be added to referenced_attachments in attachUserAndToolsToInputs

    // Map history to Warp messages (matching Python: pass None, False for last two params)
    const warpMessages = mapHistoryToWarpMessages(
        messages,
        taskId,
        toolMessageId,
        toolCallId,
        null,  // system_prompt_for_last_user
        false  // attach_to_history_last_user
    );

    // Set task context with tasks array (matching Python structure)
    packet.task_context.tasks = [{
        id: taskId,
        description: '',
        status: { in_progress: {} },
        messages: warpMessages
    }]

    // Attach the last message to inputs
    attachUserAndToolsToInputs(packet, messages, systemPrompt);

    return packet;
}

export {
    packetTemplate,
    mapHistoryToWarpMessages,
    attachUserAndToolsToInputs,
    buildWarpPacket
};
