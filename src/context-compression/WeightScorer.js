/**
 * 权重打分器 - 为消息计算权重分数
 *
 * 基础权重：
 * - 用户指令: 100 (永不压缩)
 * - 关键状态: 80 (轻度压缩)
 * - 中间推理: 40 (激进压缩)
 * - 失败记录: 20 (可抛弃)
 *
 * 调整因素：
 * - 时间衰减：越旧的消息权重越低
 * - 内容长度：过长的内容可能需要压缩
 * - 引用关系：被后续消息引用的内容权重提升
 */

import { MessageCategory } from './MessageClassifier.js';

// 基础权重配置
const BASE_WEIGHTS = {
  [MessageCategory.USER_INSTRUCTION]: 100,
  [MessageCategory.KEY_STATE]: 80,
  [MessageCategory.INTERMEDIATE_REASONING]: 40,
  [MessageCategory.FAILURE_RECORD]: 20
};

// 压缩阈值配置
const COMPRESSION_THRESHOLDS = {
  KEEP: 70,           // >= 70 保留原样
  LIGHT_COMPRESS: 50, // 50-69 轻度压缩
  HEAVY_COMPRESS: 30, // 30-49 激进压缩
  DISCARD: 0          // < 30 可丢弃
};

export class WeightScorer {
  constructor(options = {}) {
    this.baseWeights = options.baseWeights || BASE_WEIGHTS;
    this.thresholds = options.thresholds || COMPRESSION_THRESHOLDS;

    // 时间衰减配置
    this.timeDecay = {
      enabled: options.timeDecayEnabled !== false,
      halfLife: options.timeDecayHalfLife || 20, // 每20条消息权重减半
      minFactor: options.timeDecayMinFactor || 0.3 // 最低衰减到30%
    };

    // 内容长度惩罚配置
    this.lengthPenalty = {
      enabled: options.lengthPenaltyEnabled !== false,
      threshold: options.lengthThreshold || 2000, // 超过2000字符开始惩罚
      maxPenalty: options.maxLengthPenalty || 0.3 // 最多减少30%权重
    };
  }

  /**
   * 计算单条消息的权重分数
   * @param {Object} classifiedMessage - 包含 message 和 classification 的对象
   * @param {number} totalMessages - 消息总数
   * @param {Object} context - 上下文信息（引用关系等）
   * @returns {Object} 包含分数和压缩建议的对象
   */
  score(classifiedMessage, totalMessages, context = {}) {
    const { message, classification } = classifiedMessage;
    const { category, index } = classification;

    // 1. 获取基础权重
    let score = this.baseWeights[category] || 40;

    // 2. 应用时间衰减
    if (this.timeDecay.enabled) {
      const decayFactor = this._calculateTimeDecay(index, totalMessages);
      score *= decayFactor;
    }

    // 3. 应用内容长度惩罚
    if (this.lengthPenalty.enabled) {
      const lengthFactor = this._calculateLengthPenalty(message);
      score *= lengthFactor;
    }

    // 4. 应用引用加成
    if (context.referencedIndices?.has(index)) {
      score *= 1.2; // 被引用的消息权重提升20%
    }

    // 5. 特殊规则：用户指令永不低于阈值
    if (category === MessageCategory.USER_INSTRUCTION) {
      score = Math.max(score, this.thresholds.KEEP);
    }

    // 6. 确保分数在有效范围内
    score = Math.max(0, Math.min(100, score));

    return {
      score: Math.round(score * 100) / 100,
      category,
      index,
      compression: this._getCompressionLevel(score),
      factors: {
        baseWeight: this.baseWeights[category],
        timeDecay: this.timeDecay.enabled ? this._calculateTimeDecay(index, totalMessages) : 1,
        lengthPenalty: this.lengthPenalty.enabled ? this._calculateLengthPenalty(message) : 1,
        referenced: context.referencedIndices?.has(index) || false
      }
    };
  }

  /**
   * 批量计算消息权重
   * @param {Array} classifiedMessages - 分类后的消息数组
   * @param {Object} context - 上下文信息
   * @returns {Array} 带分数的消息数组
   */
  scoreAll(classifiedMessages, context = {}) {
    const totalMessages = classifiedMessages.length;

    // 分析引用关系
    const referencedIndices = context.referencedIndices ||
      this._analyzeReferences(classifiedMessages);

    return classifiedMessages.map(item => ({
      ...item,
      scoring: this.score(item, totalMessages, { ...context, referencedIndices })
    }));
  }

  /**
   * 根据分数筛选消息
   * @param {Array} scoredMessages - 带分数的消息数组
   * @param {Object} options - 筛选选项
   * @returns {Object} 分组后的消息
   */
  filterByScore(scoredMessages, options = {}) {
    const {
      keepThreshold = this.thresholds.KEEP,
      lightCompressThreshold = this.thresholds.LIGHT_COMPRESS,
      heavyCompressThreshold = this.thresholds.HEAVY_COMPRESS
    } = options;

    const result = {
      keep: [],           // 保留原样
      lightCompress: [],  // 轻度压缩
      heavyCompress: [],  // 激进压缩
      discard: []         // 可丢弃
    };

    for (const item of scoredMessages) {
      const score = item.scoring.score;

      if (score >= keepThreshold) {
        result.keep.push(item);
      } else if (score >= lightCompressThreshold) {
        result.lightCompress.push(item);
      } else if (score >= heavyCompressThreshold) {
        result.heavyCompress.push(item);
      } else {
        result.discard.push(item);
      }
    }

    return result;
  }

  /**
   * 获取压缩统计信息
   * @param {Array} scoredMessages - 带分数的消息数组
   * @returns {Object} 统计信息
   */
  getStatistics(scoredMessages) {
    const filtered = this.filterByScore(scoredMessages);

    const stats = {
      total: scoredMessages.length,
      keep: filtered.keep.length,
      lightCompress: filtered.lightCompress.length,
      heavyCompress: filtered.heavyCompress.length,
      discard: filtered.discard.length,
      averageScore: 0,
      categoryDistribution: {}
    };

    // 计算平均分
    if (scoredMessages.length > 0) {
      const totalScore = scoredMessages.reduce((sum, item) => sum + item.scoring.score, 0);
      stats.averageScore = Math.round(totalScore / scoredMessages.length * 100) / 100;
    }

    // 统计分类分布
    for (const item of scoredMessages) {
      const category = item.classification.category;
      stats.categoryDistribution[category] = (stats.categoryDistribution[category] || 0) + 1;
    }

    return stats;
  }

  // ============ 私有方法 ============

  /**
   * 计算时间衰减因子
   * 使用指数衰减：factor = max(minFactor, 2^(-age/halfLife))
   */
  _calculateTimeDecay(index, totalMessages) {
    const age = totalMessages - index - 1; // 消息年龄（距离最新消息的距离）
    const { halfLife, minFactor } = this.timeDecay;

    const decayFactor = Math.pow(2, -age / halfLife);
    return Math.max(minFactor, decayFactor);
  }

  /**
   * 计算内容长度惩罚因子
   */
  _calculateLengthPenalty(message) {
    const contentLength = this._getContentLength(message);
    const { threshold, maxPenalty } = this.lengthPenalty;

    if (contentLength <= threshold) {
      return 1; // 不惩罚
    }

    // 超出部分按比例惩罚，最多减少 maxPenalty
    const excess = contentLength - threshold;
    const penaltyRatio = Math.min(excess / threshold, 1);
    return 1 - (penaltyRatio * maxPenalty);
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
        if (block.type === 'tool_result') {
          return sum + JSON.stringify(block.content || '').length;
        }
        return sum + JSON.stringify(block).length;
      }, 0);
    }

    return JSON.stringify(content).length;
  }

  /**
   * 获取压缩级别
   */
  _getCompressionLevel(score) {
    if (score >= this.thresholds.KEEP) {
      return 'keep';
    }
    if (score >= this.thresholds.LIGHT_COMPRESS) {
      return 'light_compress';
    }
    if (score >= this.thresholds.HEAVY_COMPRESS) {
      return 'heavy_compress';
    }
    return 'discard';
  }

  /**
   * 分析消息间的引用关系
   * 简单实现：检查后续消息是否提到了之前消息的关键内容
   */
  _analyzeReferences(classifiedMessages) {
    const referencedIndices = new Set();

    // 提取每条消息的关键标识符（文件路径、函数名等）
    const identifiers = classifiedMessages.map(item =>
      this._extractIdentifiers(item.message)
    );

    // 检查后续消息是否引用了之前的标识符
    for (let i = 1; i < classifiedMessages.length; i++) {
      const currentContent = this._getContentText(classifiedMessages[i].message);

      for (let j = 0; j < i; j++) {
        for (const id of identifiers[j]) {
          if (currentContent.includes(id)) {
            referencedIndices.add(j);
            break;
          }
        }
      }
    }

    return referencedIndices;
  }

  /**
   * 从消息中提取关键标识符
   */
  _extractIdentifiers(message) {
    const identifiers = [];
    const content = this._getContentText(message);

    // 提取文件路径
    const pathPattern = /(?:\/|\\)?[\w\-\.]+(?:\/|\\)[\w\-\.\/\\]+\.\w+/g;
    const paths = content.match(pathPattern) || [];
    identifiers.push(...paths);

    // 提取函数名（简单模式）
    const funcPattern = /\b(?:function|def|const|let|var)\s+(\w+)/g;
    let match;
    while ((match = funcPattern.exec(content)) !== null) {
      identifiers.push(match[1]);
    }

    return identifiers;
  }

  /**
   * 获取消息的文本内容
   */
  _getContentText(message) {
    const content = message.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(block => {
          if (block.type === 'text') return block.text || '';
          if (block.type === 'tool_result') return JSON.stringify(block.content || '');
          return '';
        })
        .join('\n');
    }

    return '';
  }
}

export { BASE_WEIGHTS, COMPRESSION_THRESHOLDS };
export default WeightScorer;
