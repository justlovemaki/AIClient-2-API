/**
 * 上下文压缩器 - 整合所有压缩组件的主入口
 *
 * 处理流水线：
 * 1. 文件修改追踪 - 建立文件修改历史
 * 2. 语义去重 - 合并重复的工具调用结果
 * 3. 消息分类 - 将消息分为4类
 * 4. 权重打分 - 为消息计算权重分数
 * 5. 压缩处理 - 根据分数进行压缩或丢弃
 *
 * 预期效果：
 * - 读取同一文件5次：压缩率 ~76%
 * - 相同搜索3次：压缩率 ~60%
 * - 重复错误信息：压缩率 ~75%
 * - 整体预期：在权重压缩基础上，额外提升 20-40% 压缩率
 */

import { MessageClassifier, MessageCategory } from './MessageClassifier.js';
import { WeightScorer, COMPRESSION_THRESHOLDS } from './WeightScorer.js';
import { SemanticDeduplicator } from './SemanticDeduplicator.js';
import { FileModificationTracker } from './FileModificationTracker.js';

// 默认配置
const DEFAULT_CONFIG = {
  // 是否启用语义去重
  enableDeduplication: true,

  // 是否启用权重压缩
  enableWeightCompression: true,

  // 是否启用时间衰减
  enableTimeDecay: true,

  // 时间衰减半衰期（消息数）
  timeDecayHalfLife: 20,

  // 压缩阈值
  thresholds: COMPRESSION_THRESHOLDS,

  // 最大保留消息数（0 表示不限制）
  maxMessages: 0,

  // 目标压缩率（0-1，0 表示不限制）
  targetCompressionRatio: 0,

  // 是否保留压缩元数据
  preserveMetadata: false,

  // 摘要生成器（可选，用于激进压缩）
  summaryGenerator: null
};

export class ContextCompressor {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化组件
    this.classifier = new MessageClassifier();
    this.scorer = new WeightScorer({
      timeDecayEnabled: this.config.enableTimeDecay,
      timeDecayHalfLife: this.config.timeDecayHalfLife,
      thresholds: this.config.thresholds
    });
    this.deduplicator = new SemanticDeduplicator();
    this.fileTracker = new FileModificationTracker();
  }

  /**
   * 压缩消息数组
   * @param {Array} messages - 原始消息数组
   * @param {Object} options - 压缩选项
   * @returns {Object} 压缩结果
   */
  compress(messages, options = {}) {
    const startTime = Date.now();
    const mergedOptions = { ...this.config, ...options };

    // 记录原始状态
    const originalCount = messages.length;
    const originalSize = this._estimateSize(messages);

    let processedMessages = [...messages];
    const stages = [];

    // 阶段1：文件修改追踪
    this.fileTracker.processMessages(processedMessages);
    stages.push({
      name: 'file_tracking',
      stats: this.fileTracker.getStatistics()
    });

    // 阶段2：语义去重
    if (mergedOptions.enableDeduplication) {
      const deduplicationResult = this.deduplicator.deduplicate(
        processedMessages,
        this.fileTracker
      );
      processedMessages = deduplicationResult.messages;
      stages.push({
        name: 'deduplication',
        originalCount: deduplicationResult.originalCount,
        deduplicatedCount: deduplicationResult.deduplicatedCount,
        duplicatesFound: deduplicationResult.duplicatesFound,
        compressionRatio: deduplicationResult.compressionRatio
      });
    }

    // 阶段3：消息分类
    const classifiedMessages = this.classifier.classifyAll(processedMessages);
    stages.push({
      name: 'classification',
      distribution: this._getClassificationDistribution(classifiedMessages)
    });

    // 阶段4：权重打分
    if (mergedOptions.enableWeightCompression) {
      const scoredMessages = this.scorer.scoreAll(classifiedMessages);
      stages.push({
        name: 'scoring',
        stats: this.scorer.getStatistics(scoredMessages)
      });

      // 阶段5：根据分数进行压缩
      processedMessages = this._applyWeightCompression(
        scoredMessages,
        mergedOptions
      );
    } else {
      processedMessages = classifiedMessages.map(item => item.message);
    }

    // 阶段6：应用消息数量限制
    if (mergedOptions.maxMessages > 0 && processedMessages.length > mergedOptions.maxMessages) {
      processedMessages = this._applyMessageLimit(
        processedMessages,
        mergedOptions.maxMessages
      );
    }

    // 计算最终统计
    const finalCount = processedMessages.length;
    const finalSize = this._estimateSize(processedMessages);
    const processingTime = Date.now() - startTime;

    return {
      messages: processedMessages,
      statistics: {
        originalCount,
        finalCount,
        messagesRemoved: originalCount - finalCount,
        originalSize,
        finalSize,
        compressionRatio: Math.round((1 - finalSize / originalSize) * 100),
        processingTime,
        stages
      },
      metadata: mergedOptions.preserveMetadata ? {
        fileModifications: this.fileTracker.getStatistics(),
        config: mergedOptions
      } : undefined
    };
  }

  /**
   * 快速压缩 - 只进行语义去重，不进行权重压缩
   * @param {Array} messages - 原始消息数组
   * @returns {Object} 压缩结果
   */
  quickCompress(messages) {
    return this.compress(messages, {
      enableDeduplication: true,
      enableWeightCompression: false
    });
  }

  /**
   * 激进压缩 - 最大程度压缩，可能丢失部分信息
   * @param {Array} messages - 原始消息数组
   * @param {number} targetRatio - 目标压缩率 (0-1)
   * @returns {Object} 压缩结果
   */
  aggressiveCompress(messages, targetRatio = 0.5) {
    return this.compress(messages, {
      enableDeduplication: true,
      enableWeightCompression: true,
      targetCompressionRatio: targetRatio,
      thresholds: {
        KEEP: 80,
        LIGHT_COMPRESS: 60,
        HEAVY_COMPRESS: 40,
        DISCARD: 0
      }
    });
  }

  /**
   * 应用权重压缩
   */
  _applyWeightCompression(scoredMessages, options) {
    const filtered = this.scorer.filterByScore(scoredMessages);
    const result = [];

    // 保留高分消息
    for (const item of filtered.keep) {
      result.push(item.message);
    }

    // 轻度压缩消息
    for (const item of filtered.lightCompress) {
      const compressed = this._lightCompress(item);
      result.push(compressed);
    }

    // 激进压缩消息
    for (const item of filtered.heavyCompress) {
      const compressed = this._heavyCompress(item);
      if (compressed) {
        result.push(compressed);
      }
    }

    // 丢弃低分消息（不添加到结果中）
    // filtered.discard 中的消息被丢弃

    // 按原始顺序排序
    result.sort((a, b) => {
      const indexA = a._originalIndex ?? scoredMessages.findIndex(s => s.message === a);
      const indexB = b._originalIndex ?? scoredMessages.findIndex(s => s.message === b);
      return indexA - indexB;
    });

    return result;
  }

  /**
   * 轻度压缩消息
   */
  _lightCompress(scoredItem) {
    const { message, classification } = scoredItem;

    // 用户指令不压缩
    if (classification.category === MessageCategory.USER_INSTRUCTION) {
      return message;
    }

    // 工具结果：截断过长内容
    if (message.role === 'tool' || classification.reason?.includes('tool_result')) {
      return this._truncateToolResult(message, 1000);
    }

    // 其他消息：截断过长文本
    return this._truncateMessage(message, 500);
  }

  /**
   * 激进压缩消息
   */
  _heavyCompress(scoredItem) {
    const { message, classification } = scoredItem;

    // 用户指令不压缩
    if (classification.category === MessageCategory.USER_INSTRUCTION) {
      return message;
    }

    // 失败记录：只保留摘要
    if (classification.category === MessageCategory.FAILURE_RECORD) {
      return this._createSummaryMessage(message, '失败记录');
    }

    // 中间推理：只保留关键信息
    if (classification.category === MessageCategory.INTERMEDIATE_REASONING) {
      return this._createSummaryMessage(message, '中间推理');
    }

    // 工具结果：极度截断
    if (message.role === 'tool') {
      return this._truncateToolResult(message, 200);
    }

    return this._truncateMessage(message, 200);
  }

  /**
   * 截断工具结果
   */
  _truncateToolResult(message, maxLength) {
    const newMessage = { ...message };

    if (typeof newMessage.content === 'string') {
      if (newMessage.content.length > maxLength) {
        newMessage.content = newMessage.content.substring(0, maxLength) +
          `\n... [已截断，原长度: ${message.content.length} 字符]`;
      }
    } else if (Array.isArray(newMessage.content)) {
      newMessage.content = newMessage.content.map(block => {
        if (block.type === 'text' && block.text?.length > maxLength) {
          return {
            ...block,
            text: block.text.substring(0, maxLength) +
              `\n... [已截断，原长度: ${block.text.length} 字符]`
          };
        }
        return block;
      });
    }

    return newMessage;
  }

  /**
   * 截断消息
   */
  _truncateMessage(message, maxLength) {
    const newMessage = { ...message };

    if (typeof newMessage.content === 'string') {
      if (newMessage.content.length > maxLength) {
        newMessage.content = newMessage.content.substring(0, maxLength) + '...';
      }
    } else if (Array.isArray(newMessage.content)) {
      newMessage.content = newMessage.content.map(block => {
        if (block.type === 'text' && block.text?.length > maxLength) {
          return {
            ...block,
            text: block.text.substring(0, maxLength) + '...'
          };
        }
        return block;
      });
    }

    return newMessage;
  }

  /**
   * 创建摘要消息
   */
  _createSummaryMessage(message, type) {
    const contentLength = this._getContentLength(message);

    return {
      ...message,
      content: `[${type}已压缩] 原内容长度: ${contentLength} 字符`,
      _compressed: true,
      _originalLength: contentLength
    };
  }

  /**
   * 应用消息数量限制
   */
  _applyMessageLimit(messages, maxMessages) {
    if (messages.length <= maxMessages) {
      return messages;
    }

    // 保留策略：保留最新的消息，但确保保留所有用户消息
    const userMessages = messages.filter(m => m.role === 'user');
    const otherMessages = messages.filter(m => m.role !== 'user');

    // 计算可以保留的非用户消息数量
    const availableSlots = maxMessages - userMessages.length;

    if (availableSlots <= 0) {
      // 用户消息已经超过限制，只保留最新的用户消息
      return userMessages.slice(-maxMessages);
    }

    // 保留最新的非用户消息
    const keptOtherMessages = otherMessages.slice(-availableSlots);

    // 合并并按原始顺序排序
    const result = [...userMessages, ...keptOtherMessages];
    result.sort((a, b) => {
      const indexA = messages.indexOf(a);
      const indexB = messages.indexOf(b);
      return indexA - indexB;
    });

    return result;
  }

  /**
   * 获取分类分布
   */
  _getClassificationDistribution(classifiedMessages) {
    const distribution = {};
    for (const item of classifiedMessages) {
      const category = item.classification.category;
      distribution[category] = (distribution[category] || 0) + 1;
    }
    return distribution;
  }

  /**
   * 估算消息大小（字符数）
   */
  _estimateSize(messages) {
    return JSON.stringify(messages).length;
  }

  /**
   * 获取消息内容长度
   */
  _getContentLength(message) {
    const content = message.content;

    if (typeof content === 'string') {
      return content.length;
    }

    if (Array.isArray(content)) {
      return content.reduce((sum, block) => {
        if (block.type === 'text') {
          return sum + (block.text?.length || 0);
        }
        return sum + JSON.stringify(block).length;
      }, 0);
    }

    return JSON.stringify(content).length;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // 更新子组件配置
    if (newConfig.timeDecayHalfLife !== undefined || newConfig.enableTimeDecay !== undefined) {
      this.scorer = new WeightScorer({
        timeDecayEnabled: this.config.enableTimeDecay,
        timeDecayHalfLife: this.config.timeDecayHalfLife,
        thresholds: this.config.thresholds
      });
    }
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}

export default ContextCompressor;
