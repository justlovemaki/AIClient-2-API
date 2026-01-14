/**
 * 上下文压缩模块 - 入口文件
 *
 * 通过消息分类、权重打分和语义去重实现上下文压缩
 *
 * 使用示例：
 * ```javascript
 * import { ContextCompressor } from './context-compression/index.js';
 *
 * const compressor = new ContextCompressor();
 * const result = compressor.compress(messages);
 *
 * console.log(`压缩率: ${result.statistics.compressionRatio}%`);
 * console.log(`消息数: ${result.statistics.originalCount} -> ${result.statistics.finalCount}`);
 * ```
 */

import { ContextCompressor } from './ContextCompressor.js';

// 主压缩器
export { ContextCompressor, default } from './ContextCompressor.js';

// 消息分类器
export { MessageClassifier, MessageCategory } from './MessageClassifier.js';

// 权重打分器
export { WeightScorer, BASE_WEIGHTS, COMPRESSION_THRESHOLDS } from './WeightScorer.js';

// 语义去重器
export { SemanticDeduplicator, IDEMPOTENT_TOOLS, SIMILARITY_THRESHOLDS } from './SemanticDeduplicator.js';

// 文件修改追踪器
export { FileModificationTracker, FILE_MODIFICATION_TOOLS, BASH_WRITE_PATTERNS } from './FileModificationTracker.js';

// 手动压缩器（调用 Kiro API）
export { ManualCompressor } from './ManualCompressor.js';

/**
 * 快捷函数：压缩消息数组
 * @param {Array} messages - 消息数组
 * @param {Object} options - 压缩选项
 * @returns {Object} 压缩结果
 */
export function compressContext(messages, options = {}) {
  const compressor = new ContextCompressor(options);
  return compressor.compress(messages, options);
}

/**
 * 快捷函数：快速去重（不进行权重压缩）
 * @param {Array} messages - 消息数组
 * @returns {Object} 去重结果
 */
export function quickDeduplicate(messages) {
  const compressor = new ContextCompressor();
  return compressor.quickCompress(messages);
}

/**
 * 快捷函数：激进压缩
 * @param {Array} messages - 消息数组
 * @param {number} targetRatio - 目标压缩率 (0-1)
 * @returns {Object} 压缩结果
 */
export function aggressiveCompress(messages, targetRatio = 0.5) {
  const compressor = new ContextCompressor();
  return compressor.aggressiveCompress(messages, targetRatio);
}

/**
 * 快捷函数：手动压缩（调用 Kiro API）
 * @param {Array} messages - 消息数组
 * @param {Object} options - 压缩选项
 * @returns {Promise<Object>} 压缩结果
 */
export async function manualCompress(messages, options = {}) {
  const { ManualCompressor } = await import('./ManualCompressor.js');
  const compressor = new ManualCompressor(options);
  return compressor.compress(messages, options);
}
