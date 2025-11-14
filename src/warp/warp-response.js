/**
 * Warp API Response Parsing
 * Adapted from Python warp2protobuf/warp/response.py
 * 
 * Handles parsing of protobuf responses and extraction of OpenAI-compatible content.
 */

import warpProtobufUtils from './warp-protobuf-utils.js';

/**
 * Convert google.protobuf.Value to plain JavaScript value
 * @param {Object} value - Protobuf Value object
 * @returns {*} Plain JavaScript value
 */
function convertProtobufValue(value) {
    if (!value) return null;
    
    // Check which oneof field is set
    if (value.nullValue !== undefined) return null;
    if (value.numberValue !== undefined) return value.numberValue;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.boolValue !== undefined) return value.boolValue;
    
    if (value.structValue && value.structValue.fields) {
        const result = {};
        for (const [key, val] of Object.entries(value.structValue.fields)) {
            result[key] = convertProtobufValue(val);
        }
        return result;
    }
    
    if (value.listValue && value.listValue.values) {
        return value.listValue.values.map(v => convertProtobufValue(v));
    }
    
    return null;
}

/**
 * Extract tool call information from tool_call message
 * Reduces code duplication between extractOpenAIContentFromResponse and extractOpenAISSEDeltasFromResponse
 * @param {Object} toolCall - Tool call object from protobuf
 * @returns {Object} Object with toolName and toolArgs
 */
function extractToolCallInfo(toolCall) {
    let toolName = 'unknown';
    let toolArgs = '{}';
    
    // First try call_mcp_tool (most common case)
    if (toolCall.call_mcp_tool) {
        toolName = toolCall.call_mcp_tool.name || 'unknown';
        
        // Handle google.protobuf.Struct args (protobufjs format)
        const args = toolCall.call_mcp_tool.args;
        if (typeof args === 'string') {
            toolArgs = args;
        } else if (args && args.fields) {
            // Convert protobuf Struct to plain object
            const plainArgs = {};
            for (const [key, value] of Object.entries(args.fields)) {
                plainArgs[key] = convertProtobufValue(value);
            }
            toolArgs = JSON.stringify(plainArgs);
        } else {
            toolArgs = JSON.stringify(args || {});
        }
    } else {
        // Fallback: Extract tool name and arguments from oneof tool field
        for (const [fieldName, fieldValue] of Object.entries(toolCall)) {
            if (fieldName === 'tool_call_id' || fieldName === 'tool') continue;
            
            toolName = fieldName;
            
            if (typeof fieldValue === 'object' && fieldValue !== null) {
                const toolFieldsDict = {};
                for (const [subField, subValue] of Object.entries(fieldValue)) {
                    if (typeof subValue === 'string') {
                        toolFieldsDict[subField] = subValue;
                    } else if (Array.isArray(subValue)) {
                        toolFieldsDict[subField] = subValue;
                    } else {
                        toolFieldsDict[subField] = String(subValue);
                    }
                }
                if (Object.keys(toolFieldsDict).length > 0) {
                    toolArgs = JSON.stringify(toolFieldsDict);
                }
            }
            break;
        }
    }
    
    return { toolName, toolArgs };
}

/**
 * Extract OpenAI-compatible content from Warp API response payload
 * @param {Buffer} payload - Raw protobuf bytes
 */
async function extractOpenAIContentFromResponse(payload) {
    if (!payload || payload.length === 0) {
        return {
            content: null,
            tool_calls: [],
            finish_reason: null,
            metadata: {}
        };
    }

    try {
        // Parse protobuf response from bytes (like Python does)
        const response = await warpProtobufUtils.protobufToDict(payload, 'warp.multi_agent.v1.ResponseEvent');
        
        const result = {
            content: '',
            tool_calls: [],
            finish_reason: null,
            metadata: {}
        };

        // Process client_actions
        if (response.client_actions && response.client_actions.actions) {
            for (let i = 0; i < response.client_actions.actions.length; i++) {
                const action = response.client_actions.actions[i];

                // Handle append_to_message_content
                // Python checks: if action.HasField("append_to_message_content")
                if (action.append_to_message_content) {
                    const message = action.append_to_message_content.message;
                    
                    // Python checks: if message.HasField("agent_output")
                    if (message.message === 'agent_output' && message.agent_output) {
                        const agentOutput = message.agent_output;
                        if (agentOutput.text) {
                            result.content += agentOutput.text;
                        }
                        if (agentOutput.reasoning) {
                            if (!result.reasoning) {
                                result.reasoning = '';
                            }
                            result.reasoning += agentOutput.reasoning;
                        }
                    }

                    // Python checks: if message.HasField("tool_call")
                    if (message.message === 'tool_call' && message.tool_call) {
                        const toolCall = message.tool_call;
                        const { toolName, toolArgs } = extractToolCallInfo(toolCall);
                        
                        const openaiToolCall = {
                            id: toolCall.tool_call_id || `call_${i}`,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: toolArgs
                            }
                        };
                        result.tool_calls.push(openaiToolCall);
                    }
                }
                
                // Handle add_messages_to_task
                // Python checks: elif action.HasField("add_messages_to_task")
                else if (action.add_messages_to_task) {
                    const messages = action.add_messages_to_task.messages || [];
                    
                    for (let j = 0; j < messages.length; j++) {
                        const msg = messages[j];
                        
                        // Python checks: if msg.HasField("agent_output") and msg.agent_output.text
                        if (msg.message === 'agent_output' && msg.agent_output && msg.agent_output.text) {
                            result.content += msg.agent_output.text;
                        }

                        // Python checks: if msg.HasField("tool_call")
                        if (msg.message === 'tool_call' && msg.tool_call) {
                            const toolCall = msg.tool_call;
                            const toolCallId = toolCall.tool_call_id || `call_${i}_${j}`;
                            const { toolName, toolArgs } = extractToolCallInfo(toolCall);

                            const openaiToolCall = {
                                id: toolCallId,
                                type: 'function',
                                function: {
                                    name: toolName,
                                    arguments: toolArgs
                                }
                            };
                            result.tool_calls.push(openaiToolCall);
                        }
                    }
                }
                
                // Handle update_task_message
                // Python checks: elif action.HasField("update_task_message")
                else if (action.update_task_message) {
                    const umsg = action.update_task_message.message;
                    if (umsg && umsg.message === 'agent_output' && umsg.agent_output && umsg.agent_output.text) {
                        result.content += umsg.agent_output.text;
                    }
                }
                
                // Handle create_task
                // Python checks: elif action.HasField("create_task")
                else if (action.create_task) {
                    const task = action.create_task.task;
                    if (task && task.messages) {
                        for (const msg of task.messages) {
                            if (msg.message === 'agent_output' && msg.agent_output && msg.agent_output.text) {
                                result.content += msg.agent_output.text;
                            }
                        }
                    }
                }
                
                // Handle update_task_summary
                // Python checks: elif action.HasField("update_task_summary")
                else if (action.update_task_summary) {
                    const summary = action.update_task_summary.summary;
                    if (summary) {
                        result.content += summary;
                    }
                }
            }
        }

        // Check for finished status
        if (response.finished) {
            result.finish_reason = 'stop';
        }

        // Add metadata
        result.metadata = {
            response_fields: Object.keys(response),
            has_client_actions: !!response.client_actions
        };

        return result;
    } catch (error) {
        console.error(`[Warp Response] Exception occurred: ${error.message}`);
        return {
            content: null,
            tool_calls: [],
            finish_reason: 'error',
            metadata: { error: error.message }
        };
    }
}

/**
 * Extract text from response (simplified version)
 * @param {Buffer} payload - Raw protobuf bytes
 */
async function extractTextFromResponse(payload) {
    const result = await extractOpenAIContentFromResponse(payload);
    return result.content || null;
}

/**
 * Extract OpenAI SSE deltas from response
 * @param {Buffer} payload - Raw protobuf bytes
 */
async function extractOpenAISSEDeltasFromResponse(payload) {
    if (!payload || payload.length === 0) {
        return [];
    }

    try {
        // Parse protobuf response from bytes (like Python does)
        const response = await warpProtobufUtils.protobufToDict(payload, 'warp.multi_agent.v1.ResponseEvent');
        
        const deltas = [];

        // Process client_actions
        if (response.client_actions && response.client_actions.actions) {
            for (let i = 0; i < response.client_actions.actions.length; i++) {
                const action = response.client_actions.actions[i];

                // Handle append_to_message_content
                // Python checks: if action.HasField("append_to_message_content")
                // In JS with protobufjs oneofs: true, we check if the field exists
                if (action.append_to_message_content) {
                    const message = action.append_to_message_content.message;
                    
                    // Python checks: if message.HasField("agent_output")
                    // In JS: check if message.message === 'agent_output' (oneof discriminator)
                    if (message.message === 'agent_output' && message.agent_output) {
                        const agentOutput = message.agent_output;
                        
                        // Only emit delta if there's actual text content
                        if (agentOutput.text) {
                            deltas.push({
                                choices: [{
                                    index: 0,
                                    delta: { content: agentOutput.text },
                                    finish_reason: null
                                }]
                            });
                        }

                        if (agentOutput.reasoning) {
                            deltas.push({
                                choices: [{
                                    index: 0,
                                    delta: { reasoning: agentOutput.reasoning },
                                    finish_reason: null
                                }]
                            });
                        }
                    }

                    // Python checks: if message.HasField("tool_call")
                    if (message.message === 'tool_call' && message.tool_call) {
                        const toolCall = message.tool_call;
                        
                        // Add role delta first
                        deltas.push({
                            choices: [{
                                index: 0,
                                delta: { role: 'assistant' },
                                finish_reason: null
                            }]
                        });

                        const { toolName, toolArgs } = extractToolCallInfo(toolCall);

                        const openaiToolCall = {
                            id: toolCall.tool_call_id || `call_${i}`,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: toolArgs
                            }
                        };

                        deltas.push({
                            choices: [{
                                index: 0,
                                delta: { tool_calls: [openaiToolCall] },
                                finish_reason: null
                            }]
                        });
                    }
                }
                
                // Handle add_messages_to_task
                // Python checks: elif action.HasField("add_messages_to_task")
                else if (action.add_messages_to_task) {
                    const messages = action.add_messages_to_task.messages || [];
                    
                    for (let j = 0; j < messages.length; j++) {
                        const msg = messages[j];
                        
                        // Python checks: if msg.HasField("agent_output") and msg.agent_output.text
                        if (msg.message === 'agent_output' && msg.agent_output && msg.agent_output.text) {
                            deltas.push({
                                choices: [{
                                    index: 0,
                                    delta: { content: msg.agent_output.text },
                                    finish_reason: null
                                }]
                            });
                        }

                        // Python checks: if msg.HasField("tool_call")
                        if (msg.message === 'tool_call' && msg.tool_call) {
                            const toolCall = msg.tool_call;
                            
                            // Add role delta for first message
                            if (j === 0) {
                                deltas.push({
                                    choices: [{
                                        index: 0,
                                        delta: { role: 'assistant' },
                                        finish_reason: null
                                    }]
                                });
                            }

                            const toolCallId = toolCall.tool_call_id || `call_${i}_${j}`;
                            const { toolName, toolArgs } = extractToolCallInfo(toolCall);

                            const openaiToolCall = {
                                id: toolCallId,
                                type: 'function',
                                function: {
                                    name: toolName,
                                    arguments: toolArgs
                                }
                            };

                            deltas.push({
                                choices: [{
                                    index: 0,
                                    delta: { tool_calls: [openaiToolCall] },
                                    finish_reason: null
                                }]
                            });
                        }
                    }
                }
                
                // Handle update_task_message
                // Python checks: elif action.HasField("update_task_message")
                else if (action.update_task_message) {
                    const umsg = action.update_task_message.message;
                    if (umsg && umsg.message === 'agent_output' && umsg.agent_output && umsg.agent_output.text) {
                        deltas.push({
                            choices: [{
                                index: 0,
                                delta: { content: umsg.agent_output.text },
                                finish_reason: null
                            }]
                        });
                    }
                }
                
                // Handle create_task
                // Python checks: elif action.HasField("create_task")
                else if (action.create_task) {
                    const task = action.create_task.task;
                    if (task && task.messages) {
                        for (const msg of task.messages) {
                            if (msg.message === 'agent_output' && msg.agent_output && msg.agent_output.text) {
                                deltas.push({
                                    choices: [{
                                        index: 0,
                                        delta: { content: msg.agent_output.text },
                                        finish_reason: null
                                    }]
                                });
                            }
                        }
                    }
                }
                
                // Handle update_task_summary
                // Python checks: elif action.HasField("update_task_summary")
                else if (action.update_task_summary) {
                    const summary = action.update_task_summary.summary;
                    if (summary) {
                        deltas.push({
                            choices: [{
                                index: 0,
                                delta: { content: summary },
                                finish_reason: null
                            }]
                        });
                    }
                }
            }
        }

        // Check for finished status
        if (response.finished) {
            deltas.push({
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            });
        }

        return deltas;
    } catch (error) {
        console.error(`[Warp Response SSE] Parse error: ${error.message}`);
        return [];
    }
}

export {
    extractOpenAIContentFromResponse,
    extractTextFromResponse,
    extractOpenAISSEDeltasFromResponse
};
