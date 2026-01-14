/**
 * 消息分类器 - 将消息分为4类
 *
 * 分类：
 * 1. USER_INSTRUCTION - 用户指令，权重最高
 * 2. KEY_STATE - 关键状态（工具调用结果、关键决策点）
 * 3. INTERMEDIATE_REASONING - 中间推理（AI思考过程）
 * 4. FAILURE_RECORD - 失败记录（错误信息、失败尝试）
 */

export const MessageCategory = {
  USER_INSTRUCTION: 'user_instruction',
  KEY_STATE: 'key_state',
  INTERMEDIATE_REASONING: 'intermediate_reasoning',
  FAILURE_RECORD: 'failure_record'
};

// 失败/错误相关的关键词
const FAILURE_KEYWORDS = [
  'error', 'failed', 'failure', 'exception', 'traceback',
  'cannot', 'unable', 'invalid', 'denied', 'rejected',
  '错误', '失败', '异常', '无法', '拒绝'
];

// 关键状态工具列表（这些工具的结果通常是重要的）
const KEY_STATE_TOOLS = [
  'Edit', 'Write', 'Bash', 'NotebookEdit',
  'TodoWrite', 'mcp__memory__create_entities',
  'mcp__memory__create_relations'
];

// 幂等/查询类工具（结果可能重复）
const IDEMPOTENT_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'mcp__memory__read_graph', 'mcp__memory__search_nodes',
  'mcp__fetch__fetch'
];

export class MessageClassifier {
  constructor(options = {}) {
    this.failureKeywords = options.failureKeywords || FAILURE_KEYWORDS;
    this.keyStateTools = options.keyStateTools || KEY_STATE_TOOLS;
    this.idempotentTools = options.idempotentTools || IDEMPOTENT_TOOLS;
  }

  /**
   * 对单条消息进行分类
   * @param {Object} message - 消息对象
   * @param {number} index - 消息在数组中的索引
   * @returns {Object} 包含分类信息的对象
   */
  classify(message, index) {
    const role = message.role;
    const content = message.content;

    // 用户消息 -> 用户指令
    if (role === 'user') {
      return {
        category: MessageCategory.USER_INSTRUCTION,
        reason: 'user_message',
        index
      };
    }

    // 系统消息 -> 关键状态
    if (role === 'system') {
      return {
        category: MessageCategory.KEY_STATE,
        reason: 'system_message',
        index
      };
    }

    // assistant 消息需要进一步分析
    if (role === 'assistant') {
      return this._classifyAssistantMessage(message, index);
    }

    // 工具结果消息
    if (role === 'tool') {
      return this._classifyToolResult(message, index);
    }

    // 默认归类为中间推理
    return {
      category: MessageCategory.INTERMEDIATE_REASONING,
      reason: 'default',
      index
    };
  }

  /**
   * 分类 assistant 消息
   */
  _classifyAssistantMessage(message, index) {
    const content = message.content;

    // 检查是否包含工具调用
    if (this._hasToolCalls(message)) {
      const toolNames = this._extractToolNames(message);

      // 如果包含关键状态工具，归类为关键状态
      if (toolNames.some(name => this.keyStateTools.includes(name))) {
        return {
          category: MessageCategory.KEY_STATE,
          reason: 'key_state_tool_call',
          tools: toolNames,
          index
        };
      }

      // 幂等工具调用归类为中间推理
      return {
        category: MessageCategory.INTERMEDIATE_REASONING,
        reason: 'idempotent_tool_call',
        tools: toolNames,
        index
      };
    }

    // 纯文本回复，检查是否包含失败信息
    if (this._containsFailureKeywords(content)) {
      return {
        category: MessageCategory.FAILURE_RECORD,
        reason: 'contains_failure_keywords',
        index
      };
    }

    // 默认为中间推理
    return {
      category: MessageCategory.INTERMEDIATE_REASONING,
      reason: 'assistant_reasoning',
      index
    };
  }

  /**
   * 分类工具结果消息
   */
  _classifyToolResult(message, index) {
    const content = this._getContentText(message.content);
    const toolName = message.tool_name || message.name || '';

    // 检查是否是失败结果
    if (this._isFailureResult(content)) {
      return {
        category: MessageCategory.FAILURE_RECORD,
        reason: 'tool_failure',
        toolName,
        index
      };
    }

    // 关键状态工具的结果
    if (this.keyStateTools.includes(toolName)) {
      return {
        category: MessageCategory.KEY_STATE,
        reason: 'key_state_tool_result',
        toolName,
        index
      };
    }

    // 幂等工具的结果归类为中间推理（可能被去重）
    if (this.idempotentTools.includes(toolName)) {
      return {
        category: MessageCategory.INTERMEDIATE_REASONING,
        reason: 'idempotent_tool_result',
        toolName,
        index
      };
    }

    // 默认为关键状态
    return {
      category: MessageCategory.KEY_STATE,
      reason: 'tool_result_default',
      toolName,
      index
    };
  }

  /**
   * 批量分类消息
   * @param {Array} messages - 消息数组
   * @returns {Array} 分类结果数组
   */
  classifyAll(messages) {
    return messages.map((msg, index) => ({
      message: msg,
      classification: this.classify(msg, index)
    }));
  }

  /**
   * 按分类分组消息
   * @param {Array} messages - 消息数组
   * @returns {Object} 按分类分组的消息
   */
  groupByCategory(messages) {
    const classified = this.classifyAll(messages);
    const groups = {
      [MessageCategory.USER_INSTRUCTION]: [],
      [MessageCategory.KEY_STATE]: [],
      [MessageCategory.INTERMEDIATE_REASONING]: [],
      [MessageCategory.FAILURE_RECORD]: []
    };

    for (const item of classified) {
      groups[item.classification.category].push(item);
    }

    return groups;
  }

  // ============ 辅助方法 ============

  _hasToolCalls(message) {
    // OpenAI 格式
    if (message.tool_calls && message.tool_calls.length > 0) {
      return true;
    }
    // Claude 格式
    if (Array.isArray(message.content)) {
      return message.content.some(block =>
        block.type === 'tool_use' || block.type === 'tool_call'
      );
    }
    return false;
  }

  _extractToolNames(message) {
    const names = [];

    // OpenAI 格式
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.function?.name) {
          names.push(call.function.name);
        }
      }
    }

    // Claude 格式
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if ((block.type === 'tool_use' || block.type === 'tool_call') && block.name) {
          names.push(block.name);
        }
      }
    }

    return names;
  }

  _getContentText(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter(block => block.type === 'text')
        .map(block => block.text || '')
        .join('\n');
    }
    return '';
  }

  _containsFailureKeywords(content) {
    const text = this._getContentText(content).toLowerCase();
    return this.failureKeywords.some(keyword =>
      text.includes(keyword.toLowerCase())
    );
  }

  _isFailureResult(content) {
    const text = typeof content === 'string' ? content : this._getContentText(content);
    const lowerText = text.toLowerCase();

    // 检查常见的错误模式
    const errorPatterns = [
      /^error:/i,
      /^failed:/i,
      /exception/i,
      /traceback/i,
      /^fatal:/i,
      /command failed/i,
      /permission denied/i,
      /not found/i,
      /no such file/i
    ];

    return errorPatterns.some(pattern => pattern.test(lowerText));
  }
}

export default MessageClassifier;
