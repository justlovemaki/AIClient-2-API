/**
 * 手动压缩器 - 通过调用 Kiro API 进行上下文压缩
 *
 * 当用户使用 /compact 命令时，调用此模块
 * API 端点: http://localhost:3060/claude-kiro-oauth/v1/messages
 *
 * 工作原理：
 * 1. 将当前对话上下文发送给 Kiro API
 * 2. 让 AI 生成压缩后的上下文摘要
 * 3. 返回压缩后的消息数组
 */

import axios from 'axios';

// 默认配置
const DEFAULT_CONFIG = {
  // Kiro API 端点
  apiEndpoint: 'http://localhost:3060/claude-kiro-oauth/v1/messages',

  // API 密钥（可选，如果 API 需要认证）
  apiKey: null,

  // 使用的模型
  model: 'claude-opus-4-5-20251101',

  // 最大输出 token
  maxTokens: 16000,

  // 请求超时（毫秒）
  timeout: 120000,

  // 压缩提示词
  systemPrompt: `你是一个专业的上下文压缩助手。你的任务是将长对话历史压缩成简洁但信息完整的摘要。

压缩规则：
1. 保留所有用户的原始请求和指令（这些是最重要的）
2. 保留关键的决策点和状态变化
3. 合并重复的操作（如多次读取同一文件）
4. 删除冗余的中间推理过程
5. 保留最终的结论和结果
6. 保留重要的错误信息和解决方案

输出格式：
- 输出压缩后的对话历史，保持原有的消息结构（role: user/assistant）
- 每条消息应该简洁但包含关键信息
- 使用 JSON 格式输出压缩后的消息数组

注意：
- 不要丢失任何用户的原始意图
- 保持对话的逻辑连贯性
- 压缩比例目标：50-70%`
};

export class ManualCompressor {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._initClient();
  }

  /**
   * 初始化 HTTP 客户端
   */
  _initClient() {
    const headers = {
      'Content-Type': 'application/json'
    };

    // 添加认证头
    if (this.config.apiKey) {
      // 支持 Bearer token 和 x-api-key 两种方式
      if (this.config.apiKey.startsWith('Bearer ')) {
        headers['Authorization'] = this.config.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        headers['x-api-key'] = this.config.apiKey;
      }
    }

    this.client = axios.create({
      timeout: this.config.timeout,
      headers
    });
  }

  /**
   * 压缩消息上下文
   * @param {Array} messages - 原始消息数组
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>} 压缩结果
   */
  async compress(messages, options = {}) {
    const startTime = Date.now();
    const mergedOptions = { ...this.config, ...options };

    // 记录原始状态
    const originalCount = messages.length;
    const originalSize = JSON.stringify(messages).length;

    try {
      // 构建压缩请求
      const compressRequest = this._buildCompressRequest(messages, mergedOptions);

      // 调用 Kiro API
      const response = await this._callKiroApi(compressRequest, mergedOptions);

      // 解析压缩结果
      const compressedMessages = this._parseCompressResponse(response, messages);

      // 计算统计信息
      const finalCount = compressedMessages.length;
      const finalSize = JSON.stringify(compressedMessages).length;
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        messages: compressedMessages,
        statistics: {
          originalCount,
          finalCount,
          messagesRemoved: originalCount - finalCount,
          originalSize,
          finalSize,
          compressionRatio: Math.round((1 - finalSize / originalSize) * 100),
          processingTime,
          apiTokensUsed: response.usage || null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages: messages, // 返回原始消息
        statistics: {
          originalCount,
          finalCount: originalCount,
          messagesRemoved: 0,
          originalSize,
          finalSize: originalSize,
          compressionRatio: 0,
          processingTime: Date.now() - startTime,
          errorDetails: error.response?.data || error.message
        }
      };
    }
  }

  /**
   * 流式压缩（支持进度回调）
   * @param {Array} messages - 原始消息数组
   * @param {Function} onProgress - 进度回调
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>} 压缩结果
   */
  async compressWithProgress(messages, onProgress, options = {}) {
    const mergedOptions = { ...this.config, ...options, stream: true };

    onProgress?.({ stage: 'preparing', progress: 0 });

    const compressRequest = this._buildCompressRequest(messages, mergedOptions);

    onProgress?.({ stage: 'calling_api', progress: 20 });

    try {
      const response = await this._callKiroApiStream(compressRequest, mergedOptions, (chunk) => {
        onProgress?.({ stage: 'receiving', progress: 20 + Math.min(chunk.length / 100, 60), chunk });
      });

      onProgress?.({ stage: 'parsing', progress: 90 });

      const compressedMessages = this._parseCompressResponse(response, messages);

      onProgress?.({ stage: 'completed', progress: 100 });

      return {
        success: true,
        messages: compressedMessages,
        statistics: {
          originalCount: messages.length,
          finalCount: compressedMessages.length,
          compressionRatio: Math.round((1 - compressedMessages.length / messages.length) * 100)
        }
      };
    } catch (error) {
      onProgress?.({ stage: 'error', progress: 0, error: error.message });
      throw error;
    }
  }

  /**
   * 构建压缩请求
   */
  _buildCompressRequest(messages, options) {
    // 将消息转换为文本格式，便于 AI 理解
    const messagesText = this._formatMessagesForCompression(messages);

    return {
      model: options.model,
      max_tokens: options.maxTokens,
      system: options.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `请压缩以下对话历史，保留关键信息：

<conversation>
${messagesText}
</conversation>

请以 JSON 数组格式输出压缩后的消息，格式如下：
\`\`\`json
[
  {"role": "user", "content": "压缩后的用户消息"},
  {"role": "assistant", "content": "压缩后的助手回复"},
  ...
]
\`\`\`

注意：
1. 保留所有用户的原始请求意图
2. 合并重复的操作结果
3. 删除冗余的中间步骤
4. 保持对话逻辑连贯`
        }
      ]
    };
  }

  /**
   * 格式化消息用于压缩
   */
  _formatMessagesForCompression(messages) {
    return messages.map((msg, index) => {
      const role = msg.role.toUpperCase();
      const content = this._extractContent(msg);
      return `[${index + 1}] ${role}:\n${content}`;
    }).join('\n\n---\n\n');
  }

  /**
   * 提取消息内容
   */
  _extractContent(message) {
    const content = message.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content.map(block => {
        if (block.type === 'text') {
          return block.text;
        }
        if (block.type === 'tool_use') {
          return `[工具调用: ${block.name}](${JSON.stringify(block.input).substring(0, 200)}...)`;
        }
        if (block.type === 'tool_result') {
          const resultText = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
          return `[工具结果](${resultText.substring(0, 500)}${resultText.length > 500 ? '...' : ''})`;
        }
        return `[${block.type}]`;
      }).join('\n');
    }

    return JSON.stringify(content);
  }

  /**
   * 调用 Kiro API
   */
  async _callKiroApi(requestBody, options) {
    const response = await this.client.post(options.apiEndpoint, requestBody);
    return response.data;
  }

  /**
   * 流式调用 Kiro API
   */
  async _callKiroApiStream(requestBody, options, onChunk) {
    const response = await this.client.post(options.apiEndpoint, {
      ...requestBody,
      stream: true
    }, {
      responseType: 'stream'
    });

    let fullContent = '';

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.text) {
                fullContent += data.delta.text;
                onChunk?.(fullContent);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      });

      response.data.on('end', () => {
        resolve({
          content: [{ type: 'text', text: fullContent }]
        });
      });

      response.data.on('error', reject);
    });
  }

  /**
   * 解析压缩响应
   */
  _parseCompressResponse(response, originalMessages) {
    // 提取响应文本
    let responseText = '';
    if (response.content && Array.isArray(response.content)) {
      responseText = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
    } else if (typeof response.content === 'string') {
      responseText = response.content;
    }

    // 尝试从响应中提取 JSON 数组
    try {
      // 查找 JSON 代码块
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          return this._validateAndNormalizeMessages(parsed);
        }
      }

      // 尝试直接解析整个响应
      const directParse = JSON.parse(responseText);
      if (Array.isArray(directParse)) {
        return this._validateAndNormalizeMessages(directParse);
      }
    } catch (e) {
      // JSON 解析失败，尝试其他方式
    }

    // 如果无法解析，创建一个摘要消息
    return this._createFallbackSummary(responseText, originalMessages);
  }

  /**
   * 验证和规范化消息
   */
  _validateAndNormalizeMessages(messages) {
    return messages
      .filter(msg => msg && msg.role && msg.content)
      .map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      }));
  }

  /**
   * 创建回退摘要
   */
  _createFallbackSummary(summaryText, originalMessages) {
    // 保留第一条用户消息
    const firstUserMessage = originalMessages.find(m => m.role === 'user');

    return [
      firstUserMessage || { role: 'user', content: '[对话开始]' },
      {
        role: 'assistant',
        content: `[上下文摘要]\n${summaryText}`
      }
    ];
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    // 如果 apiKey 变化，重新初始化客户端
    if (newConfig.apiKey !== undefined) {
      this._initClient();
    }
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.config };
  }
}

export default ManualCompressor;
