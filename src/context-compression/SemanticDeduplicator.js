/**
 * 语义去重器 - 识别并合并重复的工具调用结果
 *
 * 核心功能：
 * 1. 为工具调用生成指纹
 * 2. 识别相同/相似的工具调用结果
 * 3. 合并重复内容，保留最新或最完整的版本
 *
 * 工具分类：
 * - 幂等工具（可安全去重）：Read, Glob, Grep, WebFetch, WebSearch
 * - 非幂等工具（谨慎处理）：Edit, Write, Bash, NotebookEdit
 */

import crypto from 'crypto';

// 幂等工具列表（这些工具的相同调用应该返回相同结果）
const IDEMPOTENT_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'mcp__memory__read_graph', 'mcp__memory__search_nodes',
  'mcp__memory__open_nodes', 'mcp__fetch__fetch',
  'mcp__context7__resolve-library-id', 'mcp__context7__query-docs'
]);

// 只读 Bash 命令模式（可以去重）
const READONLY_BASH_PATTERNS = [
  /^ls\s/,
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^grep\s/,
  /^find\s/,
  /^which\s/,
  /^pwd$/,
  /^echo\s/,
  /^git\s+(status|log|diff|branch|show)/,
  /^npm\s+(list|ls|view)/,
  /^node\s+--version/,
  /^python\s+--version/
];

// 相似度阈值
const SIMILARITY_THRESHOLDS = {
  EXACT: 1.0,      // 完全相同
  HIGH: 0.9,       // 高度相似
  MEDIUM: 0.5,     // 中等相似
  LOW: 0.3         // 低相似度
};

export class SemanticDeduplicator {
  constructor(options = {}) {
    this.idempotentTools = options.idempotentTools || IDEMPOTENT_TOOLS;
    this.readonlyBashPatterns = options.readonlyBashPatterns || READONLY_BASH_PATTERNS;
    this.similarityThresholds = options.similarityThresholds || SIMILARITY_THRESHOLDS;

    // 工具调用索引：fingerprint -> [消息索引列表]
    this.toolCallIndex = new Map();

    // 去重结果缓存
    this.deduplicationCache = new Map();
  }

  /**
   * 重置内部状态
   */
  reset() {
    this.toolCallIndex.clear();
    this.deduplicationCache.clear();
  }

  /**
   * 对消息数组进行语义去重
   * @param {Array} messages - 消息数组
   * @param {Object} fileTracker - 文件修改追踪器实例
   * @returns {Object} 去重结果
   */
  deduplicate(messages, fileTracker = null) {
    this.reset();

    // 第一遍：建立工具调用索引
    this._buildToolCallIndex(messages);

    // 第二遍：识别重复并生成去重方案
    const deduplicationPlan = this._generateDeduplicationPlan(messages, fileTracker);

    // 第三遍：应用去重方案
    const deduplicatedMessages = this._applyDeduplication(messages, deduplicationPlan);

    return {
      originalCount: messages.length,
      deduplicatedCount: deduplicatedMessages.length,
      duplicatesFound: deduplicationPlan.duplicates.length,
      compressionRatio: this._calculateCompressionRatio(messages, deduplicatedMessages),
      plan: deduplicationPlan,
      messages: deduplicatedMessages
    };
  }

  /**
   * 为工具调用生成指纹
   * @param {string} toolName - 工具名称
   * @param {Object} params - 工具参数
   * @returns {string} 指纹哈希
   */
  generateFingerprint(toolName, params) {
    let fingerprintData = toolName;

    switch (toolName) {
      case 'Read':
        fingerprintData += `:${params.file_path}`;
        break;

      case 'Grep':
        fingerprintData += `:${params.pattern}:${params.path || ''}:${params.glob || ''}`;
        break;

      case 'Glob':
        fingerprintData += `:${params.pattern}:${params.path || ''}`;
        break;

      case 'WebFetch':
      case 'mcp__fetch__fetch':
        fingerprintData += `:${params.url}`;
        break;

      case 'WebSearch':
        fingerprintData += `:${params.query}`;
        break;

      case 'Bash':
        // 只对只读命令生成指纹
        if (this._isReadonlyBashCommand(params.command)) {
          fingerprintData += `:${params.command}`;
        } else {
          // 非只读命令使用唯一标识，不去重
          fingerprintData += `:${Date.now()}:${Math.random()}`;
        }
        break;

      default:
        // 其他工具使用参数的哈希
        fingerprintData += `:${JSON.stringify(params)}`;
    }

    return crypto.createHash('md5').update(fingerprintData).digest('hex');
  }

  /**
   * 计算两个内容的相似度
   * @param {string} content1 - 内容1
   * @param {string} content2 - 内容2
   * @returns {number} 相似度 (0-1)
   */
  calculateSimilarity(content1, content2) {
    if (content1 === content2) {
      return 1.0;
    }

    const str1 = typeof content1 === 'string' ? content1 : JSON.stringify(content1);
    const str2 = typeof content2 === 'string' ? content2 : JSON.stringify(content2);

    // 长度差异过大，直接返回低相似度
    const lengthRatio = Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length);
    if (lengthRatio < 0.5) {
      return lengthRatio * 0.5;
    }

    // 使用 Jaccard 相似度（基于词集合）
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // ============ 私有方法 ============

  /**
   * 建立工具调用索引
   */
  _buildToolCallIndex(messages) {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const toolCalls = this._extractToolCalls(message);

      for (const toolCall of toolCalls) {
        const fingerprint = this.generateFingerprint(toolCall.name, toolCall.params);
        const key = `${toolCall.name}:${fingerprint}`;

        if (!this.toolCallIndex.has(key)) {
          this.toolCallIndex.set(key, []);
        }
        this.toolCallIndex.get(key).push({
          messageIndex: i,
          toolCall,
          fingerprint
        });
      }
    }
  }

  /**
   * 生成去重方案
   */
  _generateDeduplicationPlan(messages, fileTracker) {
    const plan = {
      duplicates: [],      // 重复项列表
      references: [],      // 引用替换列表
      summaries: [],       // 差异摘要列表
      keep: new Set()      // 保留的消息索引
    };

    // 遍历工具调用索引，找出重复项
    for (const [key, occurrences] of this.toolCallIndex) {
      if (occurrences.length <= 1) {
        // 只出现一次，保留
        plan.keep.add(occurrences[0].messageIndex);
        continue;
      }

      // 多次出现，需要去重
      const toolName = occurrences[0].toolCall.name;

      // 检查是否是幂等工具
      if (!this._isIdempotentTool(toolName, occurrences[0].toolCall.params)) {
        // 非幂等工具，全部保留
        for (const occ of occurrences) {
          plan.keep.add(occ.messageIndex);
        }
        continue;
      }

      // 幂等工具，进行去重分析
      const deduplicationResult = this._analyzeOccurrences(occurrences, messages, fileTracker);

      plan.duplicates.push({
        key,
        toolName,
        occurrences: occurrences.map(o => o.messageIndex),
        keepIndex: deduplicationResult.keepIndex,
        strategy: deduplicationResult.strategy
      });

      // 保留最新/最完整的版本
      plan.keep.add(deduplicationResult.keepIndex);

      // 其他版本添加引用或摘要
      for (const occ of occurrences) {
        if (occ.messageIndex !== deduplicationResult.keepIndex) {
          if (deduplicationResult.strategy === 'reference') {
            plan.references.push({
              sourceIndex: occ.messageIndex,
              targetIndex: deduplicationResult.keepIndex,
              toolName
            });
          } else if (deduplicationResult.strategy === 'summary') {
            plan.summaries.push({
              sourceIndex: occ.messageIndex,
              targetIndex: deduplicationResult.keepIndex,
              toolName,
              diff: deduplicationResult.diff
            });
          }
        }
      }
    }

    // 添加非工具调用消息到保留列表
    for (let i = 0; i < messages.length; i++) {
      const toolCalls = this._extractToolCalls(messages[i]);
      if (toolCalls.length === 0) {
        plan.keep.add(i);
      }
    }

    return plan;
  }

  /**
   * 分析多次出现的工具调用
   */
  _analyzeOccurrences(occurrences, messages, fileTracker) {
    // 按消息索引排序（从旧到新）
    const sorted = [...occurrences].sort((a, b) => a.messageIndex - b.messageIndex);

    // 检查文件是否被修改过
    if (fileTracker) {
      const toolCall = sorted[0].toolCall;
      const filePath = this._extractFilePath(toolCall);

      if (filePath) {
        // 找出文件最后被修改的位置
        const lastModifiedIndex = fileTracker.getLastModificationIndex(filePath);

        if (lastModifiedIndex !== null) {
          // 过滤掉修改之前的过期结果
          const validOccurrences = sorted.filter(
            occ => occ.messageIndex > lastModifiedIndex
          );

          if (validOccurrences.length > 0) {
            // 保留最新的有效结果
            return {
              keepIndex: validOccurrences[validOccurrences.length - 1].messageIndex,
              strategy: 'reference'
            };
          }
        }
      }
    }

    // 默认保留最新的结果
    const latestOccurrence = sorted[sorted.length - 1];

    // 检查内容是否完全相同
    const contents = sorted.map(occ =>
      this._getToolResultContent(messages[occ.messageIndex])
    );

    const firstContent = contents[0];
    const allSame = contents.every(c => this.calculateSimilarity(c, firstContent) >= 0.99);

    if (allSame) {
      return {
        keepIndex: latestOccurrence.messageIndex,
        strategy: 'reference'
      };
    }

    // 内容有变化，生成差异摘要
    return {
      keepIndex: latestOccurrence.messageIndex,
      strategy: 'summary',
      diff: this._generateDiff(contents[0], contents[contents.length - 1])
    };
  }

  /**
   * 应用去重方案
   */
  _applyDeduplication(messages, plan) {
    const result = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 检查是否需要替换为引用
      const reference = plan.references.find(r => r.sourceIndex === i);
      if (reference) {
        result.push(this._createReferenceMessage(message, reference));
        continue;
      }

      // 检查是否需要添加差异摘要
      const summary = plan.summaries.find(s => s.sourceIndex === i);
      if (summary) {
        result.push(this._createSummaryMessage(message, summary));
        continue;
      }

      // 保留原消息
      if (plan.keep.has(i)) {
        result.push(message);
      }
      // 否则丢弃（不添加到结果中）
    }

    return result;
  }

  /**
   * 创建引用消息
   */
  _createReferenceMessage(originalMessage, reference) {
    const newMessage = { ...originalMessage };

    if (typeof newMessage.content === 'string') {
      newMessage.content = `[已去重] 此 ${reference.toolName} 调用结果与消息 #${reference.targetIndex + 1} 相同`;
    } else if (Array.isArray(newMessage.content)) {
      newMessage.content = [{
        type: 'text',
        text: `[已去重] 此 ${reference.toolName} 调用结果与消息 #${reference.targetIndex + 1} 相同`
      }];
    }

    newMessage._deduplicated = true;
    newMessage._referenceTarget = reference.targetIndex;

    return newMessage;
  }

  /**
   * 创建摘要消息
   */
  _createSummaryMessage(originalMessage, summary) {
    const newMessage = { ...originalMessage };
    const diffText = summary.diff || '内容已变化';

    if (typeof newMessage.content === 'string') {
      newMessage.content = `[内容已变化] 相比消息 #${summary.targetIndex + 1}: ${diffText}`;
    } else if (Array.isArray(newMessage.content)) {
      newMessage.content = [{
        type: 'text',
        text: `[内容已变化] 相比消息 #${summary.targetIndex + 1}: ${diffText}`
      }];
    }

    newMessage._deduplicated = true;
    newMessage._hasDiff = true;

    return newMessage;
  }

  /**
   * 提取工具调用
   */
  _extractToolCalls(message) {
    const toolCalls = [];

    // OpenAI 格式
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (call.function) {
          let params = {};
          try {
            params = JSON.parse(call.function.arguments || '{}');
          } catch (e) {
            params = { raw: call.function.arguments };
          }
          toolCalls.push({
            name: call.function.name,
            params,
            id: call.id
          });
        }
      }
    }

    // Claude 格式
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name,
            params: block.input || {},
            id: block.id
          });
        }
      }
    }

    return toolCalls;
  }

  /**
   * 获取工具结果内容
   */
  _getToolResultContent(message) {
    if (message.role === 'tool') {
      return message.content || '';
    }

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          return block.content || '';
        }
      }
    }

    return '';
  }

  /**
   * 检查是否是幂等工具
   */
  _isIdempotentTool(toolName, params) {
    if (this.idempotentTools.has(toolName)) {
      return true;
    }

    // Bash 命令需要特殊检查
    if (toolName === 'Bash' && params?.command) {
      return this._isReadonlyBashCommand(params.command);
    }

    return false;
  }

  /**
   * 检查是否是只读 Bash 命令
   */
  _isReadonlyBashCommand(command) {
    if (!command) return false;
    return this.readonlyBashPatterns.some(pattern => pattern.test(command.trim()));
  }

  /**
   * 从工具调用中提取文件路径
   */
  _extractFilePath(toolCall) {
    const params = toolCall.params || {};

    if (params.file_path) return params.file_path;
    if (params.path) return params.path;

    // 从 Bash 命令中提取
    if (toolCall.name === 'Bash' && params.command) {
      const match = params.command.match(/(?:cat|head|tail|less|more)\s+["']?([^\s"']+)/);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * 生成差异摘要
   */
  _generateDiff(oldContent, newContent) {
    const oldStr = typeof oldContent === 'string' ? oldContent : JSON.stringify(oldContent);
    const newStr = typeof newContent === 'string' ? newContent : JSON.stringify(newContent);

    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;

    const addedLines = Math.max(0, newLines - oldLines);
    const removedLines = Math.max(0, oldLines - newLines);

    if (addedLines === 0 && removedLines === 0) {
      return '内容有细微变化';
    }

    const parts = [];
    if (addedLines > 0) parts.push(`+${addedLines}行`);
    if (removedLines > 0) parts.push(`-${removedLines}行`);

    return parts.join(' ');
  }

  /**
   * 计算压缩率
   */
  _calculateCompressionRatio(original, deduplicated) {
    const originalSize = JSON.stringify(original).length;
    const deduplicatedSize = JSON.stringify(deduplicated).length;

    if (originalSize === 0) return 0;

    return Math.round((1 - deduplicatedSize / originalSize) * 100);
  }
}

export { IDEMPOTENT_TOOLS, SIMILARITY_THRESHOLDS };
export default SemanticDeduplicator;
