/**
 * 文件修改追踪器 - 追踪文件在对话中的修改历史
 *
 * 核心功能：
 * 1. 检测文件修改操作（Edit, Write, Bash写入命令）
 * 2. 记录文件最后被修改的消息索引
 * 3. 标记过期的 Read 结果
 *
 * 用途：
 * - 帮助语义去重器判断哪些 Read 结果已过期
 * - 避免错误地去重已变化的文件内容
 */

// 文件修改工具列表
const FILE_MODIFICATION_TOOLS = new Set([
  'Edit', 'Write', 'NotebookEdit'
]);

// Bash 写入命令模式
const BASH_WRITE_PATTERNS = [
  />\s*["']?([^\s"'|&;]+)/,           // 重定向 > file
  />>\s*["']?([^\s"'|&;]+)/,          // 追加 >> file
  /\becho\s+.*>\s*["']?([^\s"'|&;]+)/, // echo ... > file
  /\bcat\s+.*>\s*["']?([^\s"'|&;]+)/,  // cat ... > file
  /\bcp\s+\S+\s+["']?([^\s"'|&;]+)/,   // cp src dest
  /\bmv\s+\S+\s+["']?([^\s"'|&;]+)/,   // mv src dest
  /\brm\s+(-rf?\s+)?["']?([^\s"'|&;]+)/, // rm file
  /\btouch\s+["']?([^\s"'|&;]+)/,      // touch file
  /\bmkdir\s+(-p\s+)?["']?([^\s"'|&;]+)/, // mkdir dir
  /\bsed\s+-i/,                        // sed -i (in-place edit)
  /\bgit\s+(checkout|reset|revert|merge|rebase|cherry-pick)/, // git 修改操作
  /\bnpm\s+(install|uninstall|update)/, // npm 修改操作
  /\bpip\s+(install|uninstall)/        // pip 修改操作
];

export class FileModificationTracker {
  constructor() {
    // 文件路径 -> 最后修改的消息索引
    this.fileModifications = new Map();

    // 目录路径 -> 最后修改的消息索引（用于追踪目录级别的变化）
    this.directoryModifications = new Map();

    // 全局修改事件（如 git checkout 等影响多个文件的操作）
    this.globalModificationIndex = null;
  }

  /**
   * 重置追踪器状态
   */
  reset() {
    this.fileModifications.clear();
    this.directoryModifications.clear();
    this.globalModificationIndex = null;
  }

  /**
   * 处理消息数组，建立修改追踪
   * @param {Array} messages - 消息数组
   */
  processMessages(messages) {
    this.reset();

    for (let i = 0; i < messages.length; i++) {
      this._processMessage(messages[i], i);
    }
  }

  /**
   * 处理单条消息
   */
  _processMessage(message, index) {
    // 检查 assistant 消息中的工具调用
    if (message.role === 'assistant') {
      const toolCalls = this._extractToolCalls(message);

      for (const toolCall of toolCalls) {
        this._processToolCall(toolCall, index);
      }
    }
  }

  /**
   * 处理工具调用
   */
  _processToolCall(toolCall, index) {
    const { name, params } = toolCall;

    // 文件修改工具
    if (FILE_MODIFICATION_TOOLS.has(name)) {
      const filePath = params.file_path || params.notebook_path;
      if (filePath) {
        this._recordFileModification(filePath, index);
      }
      return;
    }

    // Bash 命令需要特殊分析
    if (name === 'Bash' && params.command) {
      this._processBashCommand(params.command, index);
    }
  }

  /**
   * 分析 Bash 命令中的文件修改
   */
  _processBashCommand(command, index) {
    for (const pattern of BASH_WRITE_PATTERNS) {
      const match = command.match(pattern);
      if (match) {
        // 提取文件路径（可能在不同的捕获组中）
        const filePath = match[2] || match[1];
        if (filePath && !filePath.startsWith('-')) {
          this._recordFileModification(filePath, index);
        }

        // 检查是否是全局修改操作
        if (/git\s+(checkout|reset|revert|merge|rebase)/.test(command)) {
          this.globalModificationIndex = index;
        }
      }
    }
  }

  /**
   * 记录文件修改
   */
  _recordFileModification(filePath, index) {
    // 规范化路径
    const normalizedPath = this._normalizePath(filePath);

    // 记录文件修改
    this.fileModifications.set(normalizedPath, index);

    // 记录目录修改
    const dirPath = this._getDirectoryPath(normalizedPath);
    if (dirPath) {
      this.directoryModifications.set(dirPath, index);
    }
  }

  /**
   * 获取文件最后被修改的消息索引
   * @param {string} filePath - 文件路径
   * @returns {number|null} 最后修改的消息索引，如果未被修改则返回 null
   */
  getLastModificationIndex(filePath) {
    const normalizedPath = this._normalizePath(filePath);

    // 检查全局修改
    if (this.globalModificationIndex !== null) {
      const fileModIndex = this.fileModifications.get(normalizedPath);
      if (fileModIndex === undefined || fileModIndex < this.globalModificationIndex) {
        return this.globalModificationIndex;
      }
    }

    // 检查文件级别修改
    const fileIndex = this.fileModifications.get(normalizedPath);
    if (fileIndex !== undefined) {
      return fileIndex;
    }

    // 检查目录级别修改
    const dirPath = this._getDirectoryPath(normalizedPath);
    if (dirPath) {
      const dirIndex = this.directoryModifications.get(dirPath);
      if (dirIndex !== undefined) {
        return dirIndex;
      }
    }

    return null;
  }

  /**
   * 检查文件在指定索引之后是否被修改过
   * @param {string} filePath - 文件路径
   * @param {number} afterIndex - 检查此索引之后的修改
   * @returns {boolean}
   */
  isModifiedAfter(filePath, afterIndex) {
    const lastModIndex = this.getLastModificationIndex(filePath);
    return lastModIndex !== null && lastModIndex > afterIndex;
  }

  /**
   * 检查 Read 结果是否过期
   * @param {string} filePath - 文件路径
   * @param {number} readIndex - Read 操作的消息索引
   * @returns {boolean}
   */
  isReadResultStale(filePath, readIndex) {
    return this.isModifiedAfter(filePath, readIndex);
  }

  /**
   * 获取所有被修改的文件列表
   * @returns {Array} 文件路径数组
   */
  getModifiedFiles() {
    return Array.from(this.fileModifications.keys());
  }

  /**
   * 获取修改统计信息
   * @returns {Object}
   */
  getStatistics() {
    return {
      modifiedFilesCount: this.fileModifications.size,
      modifiedDirectoriesCount: this.directoryModifications.size,
      hasGlobalModification: this.globalModificationIndex !== null,
      globalModificationIndex: this.globalModificationIndex,
      files: Array.from(this.fileModifications.entries()).map(([path, index]) => ({
        path,
        lastModifiedAt: index
      }))
    };
  }

  // ============ 辅助方法 ============

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
            params
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
            params: block.input || {}
          });
        }
      }
    }

    return toolCalls;
  }

  /**
   * 规范化文件路径
   */
  _normalizePath(filePath) {
    if (!filePath) return '';

    // 移除引号
    let normalized = filePath.replace(/^["']|["']$/g, '');

    // 统一路径分隔符
    normalized = normalized.replace(/\\/g, '/');

    // 移除末尾斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 处理相对路径中的 ./ 和 ../
    // 简单处理：移除开头的 ./
    normalized = normalized.replace(/^\.\//, '');

    return normalized;
  }

  /**
   * 获取目录路径
   */
  _getDirectoryPath(filePath) {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      return filePath.substring(0, lastSlash);
    }
    return null;
  }
}

export { FILE_MODIFICATION_TOOLS, BASH_WRITE_PATTERNS };
export default FileModificationTracker;
