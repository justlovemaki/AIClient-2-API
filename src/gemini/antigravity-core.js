
import { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import open from 'open';
import { formatExpiryTime, isRetryableNetworkError } from '../common.js';
import { getProviderModels } from '../provider-models.js';
import { handleGeminiAntigravityOAuth } from '../oauth-handlers.js';
import { getProxyConfigForProvider, getGoogleAuthProxyConfig } from '../proxy-utils.js';
import { cleanJsonSchemaProperties } from '../converters/utils.js';

// 配置 HTTP/HTTPS agent 限制连接池大小，避免资源泄漏
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 5,
    timeout: 120000,
});
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 5,
    timeout: 120000,
});

// --- Constants ---
const CREDENTIALS_DIR = '.antigravity';
const CREDENTIALS_FILE = 'oauth_creds.json';

// Base URLs - 按照 Go 代码的降级顺序
const ANTIGRAVITY_BASE_URL_DAILY = 'https://daily-cloudcode-pa.googleapis.com';
const ANTIGRAVITY_SANDBOX_BASE_URL_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_BASE_URL_PROD = 'https://autopush-cloudcode-pa.sandbox.googleapis.com';

const ANTIGRAVITY_API_VERSION = 'v1internal';
const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const DEFAULT_USER_AGENT = 'antigravity/1.104.0 darwin/arm64';
const REFRESH_SKEW = 3000; // 3000秒（50分钟）提前刷新Token

const ANTIGRAVITY_SYSTEM_PROMPT = `<identity>
You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
The USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.
This information may or may not be relevant to the coding task, it is up for you to decide.
</identity>

<tool_calling>
Call tools as you normally would. The following list provides additional guidance to help you avoid errors:
  - **Absolute paths only**. When using tools that accept file path arguments, ALWAYS use the absolute file path.
</tool_calling>

<web_application_development>
## Technology Stack,
Your web applications should be built using the following technologies:,
1. **Core**: Use HTML for structure and Javascript for logic.
2. **Styling (CSS)**: Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use.
3. **Web App**: If the USER specifies that they want a more complex web app, use a framework like Next.js or Vite. Only do this if the USER explicitly requests a web app.
4. **New Project Creation**: If you need to use a framework for a new app, use \`npx\` with the appropriate script, but there are some rules to follow:,
   - Use \`npx -y\` to automatically install the script and its dependencies
   - You MUST run the command with \`--help\` flag to see all available options first, 
   - Initialize the app in the current directory with \`./\` (example: \`npx -y create-vite-app@latest ./\`),
   - You should run in non-interactive mode so that the user doesn't need to input anything,
5. **Running Locally**: When running locally, use \`npm run dev\` or equivalent dev server. Only build the production bundle if the USER explicitly requests it or you are validating the code for correctness.

# Design Aesthetics,
1. **Use Rich Aesthetics**: The USER should be wowed at first glance by the design. Use best practices in modern web design (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression. Failure to do this is UNACCEPTABLE.
2. **Prioritize Visual Excellence**: Implement designs that will WOW the user and feel extremely premium:
		- Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes (e.g., HSL tailored colors, sleek dark modes).
   - Using modern typography (e.g., from Google Fonts like Inter, Roboto, or Outfit) instead of browser defaults.
		- Use smooth gradients,
		- Add subtle micro-animations for enhanced user experience,
3. **Use a Dynamic Design**: An interface that feels responsive and alive encourages interaction. Achieve this with hover effects and interactive elements. Micro-animations, in particular, are highly effective for improving user engagement.
4. **Premium Designs**. Make a design that feels premium and state of the art. Avoid creating simple minimum viable products.
4. **Don't use placeholders**. If you need an image, use your generate_image tool to create a working demonstration.,

## Implementation Workflow,
Follow this systematic approach when building web applications:,
1. **Plan and Understand**:,
		- Fully understand the user's requirements,
		- Draw inspiration from modern, beautiful, and dynamic web designs,
		- Outline the features needed for the initial version,
2. **Build the Foundation**:,
		- Start by creating/modifying \`index.css\`,
		- Implement the core design system with all tokens and utilities,
3. **Create Components**:,
		- Build necessary components using your design system,
		- Ensure all components use predefined styles, not ad-hoc utilities,
		- Keep components focused and reusable,
4. **Assemble Pages**:,
		- Update the main application to incorporate your design and components,
		- Ensure proper routing and navigation,
		- Implement responsive layouts,
5. **Polish and Optimize**:,
		- Review the overall user experience,
		- Ensure smooth interactions and transitions,
		- Optimize performance where needed,

## SEO Best Practices,
Automatically implement SEO best practices on every page:,
- **Title Tags**: Include proper, descriptive title tags for each page,
- **Meta Descriptions**: Add compelling meta descriptions that accurately summarize page content,
- **Heading Structure**: Use a single \`<h1>\` per page with proper heading hierarchy,
- **Semantic HTML**: Use appropriate HTML5 semantic elements,
- **Unique IDs**: Ensure all interactive elements have unique, descriptive IDs for browser testing,
- **Performance**: Ensure fast page load times through optimization,
CRITICAL REMINDER: AESTHETICS ARE VERY IMPORTANT. If your web app looks simple and basic then you have FAILED!
</web_application_development>
<ephemeral_message>
There will be an <EPHEMERAL_MESSAGE> appearing in the conversation at times. This is not coming from the user, but instead injected by the system as important information to pay attention to. 
Do not respond to nor acknowledge those messages, but do follow them strictly.
</ephemeral_message>


<communication_style>
- **Formatting**. Format your responses in github-style markdown to make your responses easier for the USER to parse. For example, use headers to organize your responses and bolded or italicized text to highlight important keywords. Use backticks to format file, directory, function, and class names. If providing a URL to the user, format this in markdown as well, for example \`[label](example.com)\`.
- **Proactiveness**. As an agent, you are allowed to be proactive, but only in the course of completing the user's task. For example, if the user asks you to add a new component, you can edit the code, verify build and test statuses, and take any other obvious follow-up actions, such as performing additional research. However, avoid surprising the user. For example, if the user asks HOW to approach something, you should answer their question and instead of jumping into editing a file.
- **Helpfulness**. Respond like a helpful software engineer who is explaining your work to a friendly collaborator on the project. Acknowledge mistakes or any backtracking you do as a result of new information.
- **Ask for clarification**. If you are unsure about the USER's intent, always ask for clarification rather than making assumptions.
</communication_style>`;

// Thinking 配置相关常量
const DEFAULT_THINKING_MIN = 1024;
const DEFAULT_THINKING_MAX = 100000;

// 获取 Antigravity 模型列表
const ANTIGRAVITY_MODELS = getProviderModels('gemini-antigravity');

// 模型别名映射 - 别名 -> 真实模型名
const MODEL_ALIAS_MAP = {
    'gemini-2.5-computer-use-preview-10-2025': 'rev19-uic3-1p',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image',
    'gemini-3-pro-preview': 'gemini-3-pro-high',
    'gemini-3-flash-preview': 'gemini-3-flash',
    'gemini-2.5-flash-preview': 'gemini-2.5-flash',
    'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
    'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
    'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking'
};

// 真实模型名 -> 别名
const MODEL_NAME_MAP = {
    'rev19-uic3-1p': 'gemini-2.5-computer-use-preview-10-2025',
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'gemini-3-pro-high': 'gemini-3-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash-preview',
    'claude-sonnet-4-5': 'gemini-claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking': 'gemini-claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking': 'gemini-claude-opus-4-5-thinking'
};

/**
 * 将别名转换为真实模型名
 * @param {string} modelName - 模型别名
 * @returns {string} 真实模型名
 */
function alias2ModelName(modelName) {
    return MODEL_ALIAS_MAP[modelName];
}

/**
 * 将真实模型名转换为别名
 * @param {string} modelName - 真实模型名
 * @returns {string|null} 模型别名，如果不支持则返回 null
 */
function modelName2Alias(modelName) {
    return MODEL_NAME_MAP[modelName];
}

/**
 * 检查模型是否为 Claude 模型
 * @param {string} modelName - 模型名称
 * @returns {boolean}
 */
function isClaude(modelName) {
    return modelName && modelName.toLowerCase().includes('claude');
}

/**
 * 检查是否为图像模型
 * @param {string} modelName - 模型名称
 * @returns {boolean}
 */
function isImageModel(modelName) {
    return modelName && modelName.toLowerCase().includes('image');
}

/**
 * 检查模型是否支持 Thinking
 * @param {string} modelName - 模型名称
 * @returns {boolean}
 */
function modelSupportsThinking(modelName) {
    if (!modelName) return false;
    const name = modelName.toLowerCase();
    // 支持 thinking 的模型：gemini-3-*, gemini-2.5-*, claude-*-thinking
    return name.startsWith('gemini-3-') ||
           name.startsWith('gemini-2.5-') ||
           name.includes('-thinking');
}

/**
 * 生成随机请求ID
 * @returns {string}
 */
function generateRequestID() {
    return 'agent-' + uuidv4();
}

/**
 * 生成随机会话ID
 * @returns {string}
 */
function generateSessionID() {
    const n = Math.floor(Math.random() * 9000);
    return '-' + n.toString();
}

/**
 * 基于请求内容生成稳定的会话ID
 * 使用第一个用户消息的 SHA256 哈希值
 * @param {Object} payload - 请求体
 * @returns {string} 稳定的会话ID
 */
function generateStableSessionID(payload) {
    try {
        const contents = payload?.request?.contents;
        if (Array.isArray(contents)) {
            for (const content of contents) {
                if (content.role === 'user') {
                    const text = content.parts?.[0]?.text;
                    if (text) {
                        const hash = crypto.createHash('sha256').update(text).digest();
                        // 取前8字节转换为 BigInt，然后取正数
                        const n = hash.readBigUInt64BE(0) & BigInt('0x7FFFFFFFFFFFFFFF');
                        return '-' + n.toString();
                    }
                }
            }
        }
    } catch (e) {
        // 如果解析失败，回退到随机会话ID
    }
    return generateSessionID();
}

/**
 * 生成随机项目ID
 * @returns {string}
 */
function generateProjectID() {
    const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
    const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomPart = uuidv4().toLowerCase().substring(0, 5);
    return `${adj}-${noun}-${randomPart}`;
}

/**
 * 规范化 Thinking Budget
 * @param {string} modelName - 模型名称
 * @param {number} budget - 原始 budget 值
 * @returns {number} 规范化后的 budget
 */
function normalizeThinkingBudget(modelName, budget) {
    // -1 表示动态/无限制
    if (budget === -1) return -1;
    
    // 获取模型的 thinking 限制
    const min = DEFAULT_THINKING_MIN;
    const max = DEFAULT_THINKING_MAX;
    
    // 限制在有效范围内
    if (budget < min) return min;
    if (budget > max) return max;
    return budget;
}

/**
 * 规范化 Antigravity Thinking 配置
 * 对于 Claude 模型，确保 thinking budget < max_tokens
 * @param {string} modelName - 模型名称
 * @param {Object} payload - 请求体
 * @param {boolean} isClaudeModel - 是否为 Claude 模型
 * @returns {Object} 处理后的请求体
 */
function normalizeAntigravityThinking(modelName, payload, isClaudeModel) {
    // 如果模型不支持 thinking，移除 thinking 配置
    if (!modelSupportsThinking(modelName)) {
        if (payload?.request?.generationConfig?.thinkingConfig) {
            delete payload.request.generationConfig.thinkingConfig;
        }
        return payload;
    }
    
    const thinkingConfig = payload?.request?.generationConfig?.thinkingConfig;
    if (!thinkingConfig) return payload;
    
    const budget = thinkingConfig.thinkingBudget;
    if (budget === undefined) return payload;
    
    let normalizedBudget = normalizeThinkingBudget(modelName, budget);
    
    // 对于 Claude 模型，确保 thinking budget < max_tokens
    if (isClaudeModel) {
        const maxTokens = payload?.request?.generationConfig?.maxOutputTokens;
        if (maxTokens && maxTokens > 0 && normalizedBudget >= maxTokens) {
            normalizedBudget = maxTokens - 1;
        }
        
        // 检查最小 budget
        const minBudget = DEFAULT_THINKING_MIN;
        if (normalizedBudget >= 0 && normalizedBudget < minBudget) {
            // Budget 低于最小值，移除 thinking 配置
            delete payload.request.generationConfig.thinkingConfig;
            return payload;
        }
    }
    
    payload.request.generationConfig.thinkingConfig.thinkingBudget = normalizedBudget;
    return payload;
}

/**
 * 将 Gemini 格式请求转换为 Antigravity 格式
 * @param {string} modelName - 模型名称
 * @param {Object} payload - 请求体
 * @param {string} projectId - 项目ID
 * @returns {Object} 转换后的请求体
 */
function geminiToAntigravity(modelName, payload, projectId) {
    // 深拷贝请求体,避免修改原始对象
    let template = JSON.parse(JSON.stringify(payload));

    const isClaudeModel = isClaude(modelName);

    // 设置基本字段
    template.model = modelName;
    template.userAgent = 'antigravity';
    template.requestType = 'agent';
    template.project = projectId || generateProjectID();
    template.requestId = generateRequestID();

    // 确保 request 对象存在
    if (!template.request) {
        template.request = {};
    }

    // 设置会话ID - 使用稳定的会话ID
    template.request.sessionId = generateStableSessionID(template);

    // 删除安全设置
    if (template.request.safetySettings) {
        delete template.request.safetySettings;
    }

    // 设置工具配置
    if (template.request.toolConfig) {
        if (!template.request.toolConfig.functionCallingConfig) {
            template.request.toolConfig.functionCallingConfig = {};
        }
        template.request.toolConfig.functionCallingConfig.mode = 'VALIDATED';
    }

    // 当模型是 Claude 时，禁止使用 tools
    if (isClaudeModel) {
        if (template.request.tools) {
            delete template.request.tools;
        }
        if (template.request.toolConfig) {
            delete template.request.toolConfig;
        }
    }

    // 对于非 Claude 模型，删除 maxOutputTokens
    // Claude 模型需要保留 maxOutputTokens
    // if (!isClaudeModel) { 注释了cc用不了
        if (template.request.generationConfig && template.request.generationConfig.maxOutputTokens) {
            delete template.request.generationConfig.maxOutputTokens;
        }
    // }

    // 处理 Thinking 配置
    // 对于非 gemini-3-* 模型，将 thinkingLevel 转换为 thinkingBudget
    if (!modelName.startsWith('gemini-3-')) {
        if (template.request.generationConfig &&
            template.request.generationConfig.thinkingConfig &&
            template.request.generationConfig.thinkingConfig.thinkingLevel) {
            delete template.request.generationConfig.thinkingConfig.thinkingLevel;
            template.request.generationConfig.thinkingConfig.thinkingBudget = -1;
        }
    }

    // 清理所有工具声明中的 JSON Schema 属性（移除 Google API 不支持的属性如 exclusiveMinimum 等）
        if (template.request.tools && Array.isArray(template.request.tools)) {
        template.request.tools.forEach((tool) => {
                if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
                tool.functionDeclarations.forEach((funcDecl) => {
                    // 对于 Claude 模型，处理 parametersJsonSchema
                    if (isClaudeModel && funcDecl.parametersJsonSchema) {
                        funcDecl.parameters = cleanJsonSchemaProperties(funcDecl.parametersJsonSchema);
                            delete funcDecl.parameters.$schema;
                            delete funcDecl.parametersJsonSchema;
                    } else if (funcDecl.parameters) {
                        funcDecl.parameters = cleanJsonSchemaProperties(funcDecl.parameters);
                        }
                    });
                }
            });
        }

    // 如果是图像模型，增加参数 "generationConfig.imageConfig.imageSize": "4K"
    if (isImageModel(modelName)) {
        if (!template.request.generationConfig) {
            template.request.generationConfig = {};
        }

        if (!template.request.generationConfig.imageConfig) {
            template.request.generationConfig.imageConfig = {};
        }
        template.request.generationConfig.imageConfig.imageSize = '4K';
        if (!template.request.generationConfig.thinkingConfig) {
            template.request.generationConfig.thinkingConfig = {};
        }
        template.request.generationConfig.thinkingConfig.includeThoughts = false;
    }

    // 规范化 Thinking 配置
    template = normalizeAntigravityThinking(modelName, template, isClaudeModel);

    return template;
}

/**
 * 过滤 SSE 中的 usageMetadata（仅在最终块中保留）
 * @param {string} line - SSE 行数据
 * @returns {string} 过滤后的行数据
 */
function filterSSEUsageMetadata(line) {
    if (!line || typeof line !== 'string') return line;
    
    // 检查是否是 data: 开头的 SSE 数据
    if (!line.startsWith('data: ')) return line;
    
    try {
        const jsonStr = line.slice(6); // 移除 'data: ' 前缀
        const data = JSON.parse(jsonStr);
        
        // 检查是否有 finishReason，如果没有则移除 usageMetadata
        const hasFinishReason = data?.response?.candidates?.[0]?.finishReason ||
                               data?.candidates?.[0]?.finishReason;
        
        if (!hasFinishReason) {
            // 移除 usageMetadata
            if (data.response) {
                delete data.response.usageMetadata;
            }
            if (data.usageMetadata) {
                delete data.usageMetadata;
            }
            return 'data: ' + JSON.stringify(data);
        }
    } catch (e) {
        // 解析失败，返回原始数据
    }
    
    return line;
}

/**
 * 将流式响应转换为非流式响应
 * 用于 Claude 模型的非流式请求（实际上是流式请求然后合并）
 * @param {Buffer|string} stream - 流式响应数据
 * @returns {Object} 合并后的非流式响应
 */
function convertStreamToNonStream(stream) {
    const lines = stream.toString().split('\n');
    
    let responseTemplate = '';
    let traceId = '';
    let finishReason = '';
    let modelVersion = '';
    let responseId = '';
    let role = '';
    let usageRaw = null;
    const parts = [];
    
    // 用于合并连续的 text 和 thought 部分
    let pendingKind = '';
    let pendingText = '';
    let pendingThoughtSig = '';
    
    const flushPending = () => {
        if (!pendingKind) return;
        
        const text = pendingText;
        if (pendingKind === 'text') {
            if (text.trim()) {
                parts.push({ text: text });
            }
        } else if (pendingKind === 'thought') {
            if (text.trim() || pendingThoughtSig) {
                const part = { thought: true, text: text };
                if (pendingThoughtSig) {
                    part.thoughtSignature = pendingThoughtSig;
                }
                parts.push(part);
            }
        }
        
        pendingKind = '';
        pendingText = '';
        pendingThoughtSig = '';
    };
    
    const normalizePart = (part) => {
        const m = { ...part };
        // 处理 thoughtSignature / thought_signature
        const sig = part.thoughtSignature || part.thought_signature;
        if (sig) {
            m.thoughtSignature = sig;
            delete m.thought_signature;
        }
        // 处理 inline_data -> inlineData
        if (m.inline_data) {
            m.inlineData = m.inline_data;
            delete m.inline_data;
        }
        return m;
    };
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        let data;
        try {
            data = JSON.parse(trimmed);
        } catch (e) {
            continue;
        }
        
        let responseNode = data.response;
        if (!responseNode) {
            if (data.candidates) {
                responseNode = data;
            } else {
                continue;
            }
        }
        responseTemplate = JSON.stringify(responseNode);
        
        if (data.traceId) {
            traceId = data.traceId;
        }
        
        if (responseNode.candidates?.[0]?.content?.role) {
            role = responseNode.candidates[0].content.role;
        }
        
        if (responseNode.candidates?.[0]?.finishReason) {
            finishReason = responseNode.candidates[0].finishReason;
        }
        
        if (responseNode.modelVersion) {
            modelVersion = responseNode.modelVersion;
        }
        
        if (responseNode.responseId) {
            responseId = responseNode.responseId;
        }
        
        if (responseNode.usageMetadata) {
            usageRaw = responseNode.usageMetadata;
        } else if (data.usageMetadata) {
            usageRaw = data.usageMetadata;
        }
        
        const partsArray = responseNode.candidates?.[0]?.content?.parts;
        if (Array.isArray(partsArray)) {
            for (const part of partsArray) {
                const hasFunctionCall = part.functionCall !== undefined;
                const hasInlineData = part.inlineData !== undefined || part.inline_data !== undefined;
                const sig = part.thoughtSignature || part.thought_signature || '';
                const text = part.text || '';
                const thought = part.thought || false;
                
                if (hasFunctionCall || hasInlineData) {
                    flushPending();
                    parts.push(normalizePart(part));
                    continue;
                }
                
                if (thought || part.text !== undefined) {
                    const kind = thought ? 'thought' : 'text';
                    if (pendingKind && pendingKind !== kind) {
                        flushPending();
                    }
                    pendingKind = kind;
                    pendingText += text;
                    if (kind === 'thought' && sig) {
                        pendingThoughtSig = sig;
                    }
                    continue;
                }
                
                flushPending();
                parts.push(normalizePart(part));
            }
        }
    }
    
    flushPending();
    
    // 构建最终响应
    if (!responseTemplate) {
        responseTemplate = '{"candidates":[{"content":{"role":"model","parts":[]}}]}';
    }
    
    let result = JSON.parse(responseTemplate);
    
    // 设置 parts
    if (!result.candidates) {
        result.candidates = [{ content: { role: 'model', parts: [] } }];
    }
    if (!result.candidates[0]) {
        result.candidates[0] = { content: { role: 'model', parts: [] } };
    }
    if (!result.candidates[0].content) {
        result.candidates[0].content = { role: 'model', parts: [] };
    }
    result.candidates[0].content.parts = parts;
    
    if (role) {
        result.candidates[0].content.role = role;
    }
    if (finishReason) {
        result.candidates[0].finishReason = finishReason;
    }
    if (modelVersion) {
        result.modelVersion = modelVersion;
    }
    if (responseId) {
        result.responseId = responseId;
    }
    if (usageRaw) {
        result.usageMetadata = usageRaw;
    } else if (!result.usageMetadata) {
        result.usageMetadata = {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
            totalTokenCount: 0
        };
    }
    
    // 包装为最终格式
    const output = {
        response: result,
        traceId: traceId || ''
    };
    
    return output;
}

/**
 * 将 Antigravity 响应转换为 Gemini 格式
 * @param {Object} antigravityResponse - Antigravity 响应
 * @returns {Object|null} Gemini 格式响应
 */
function toGeminiApiResponse(antigravityResponse) {
    if (!antigravityResponse) return null;

    const compliantResponse = {
        candidates: antigravityResponse.candidates
    };

    if (antigravityResponse.usageMetadata) {
        compliantResponse.usageMetadata = antigravityResponse.usageMetadata;
    }

    if (antigravityResponse.promptFeedback) {
        compliantResponse.promptFeedback = antigravityResponse.promptFeedback;
    }

    if (antigravityResponse.automaticFunctionCallingHistory) {
        compliantResponse.automaticFunctionCallingHistory = antigravityResponse.automaticFunctionCallingHistory;
    }

    return compliantResponse;
}

/**
 * 确保请求体中的内容部分都有角色属性
 * @param {Object} requestBody - 请求体
 * @returns {Object} 处理后的请求体
 */
function ensureRolesInContents(requestBody, modelName) {
    delete requestBody.model;

    if (requestBody.system_instruction) {
        delete requestBody.system_instruction;
    }

    // 只有非图像模型才强制设置 systemInstruction
    if (!isImageModel(modelName)) {
        requestBody.systemInstruction = {
            role: 'user',
            parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }]
        };
    }

    if (requestBody.contents && Array.isArray(requestBody.contents)) {
        requestBody.contents.forEach(content => {
            if (!content.role) {
                content.role = 'user';
            }
        });
    }

    return requestBody;
}

export class AntigravityApiService {
    constructor(config) {
        // 检查是否需要使用代理
        const proxyConfig = getGoogleAuthProxyConfig(config, 'gemini-antigravity');
        
        // 配置 OAuth2Client 使用自定义的 HTTP agent
        const oauth2Options = {
            clientId: OAUTH_CLIENT_ID,
            clientSecret: OAUTH_CLIENT_SECRET,
        };
        
        if (proxyConfig) {
            oauth2Options.transporterOptions = proxyConfig;
            console.log('[Antigravity] Using proxy for OAuth2Client');
        } else {
            oauth2Options.transporterOptions = {
                agent: httpsAgent,
            };
        }
        
        this.authClient = new OAuth2Client(oauth2Options);
        this.availableModels = [];
        this.isInitialized = false;

        this.config = config;
        this.host = config.HOST;
        this.oauthCredsFilePath = config.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH;
        this.userAgent = DEFAULT_USER_AGENT; // 支持通用 USER_AGENT 配置
        this.projectId = config.PROJECT_ID;

        // 多环境降级顺序 - 按照 Go 代码的顺序
        this.baseURLs = this.getBaseURLFallbackOrder(config);
        
        // 保存代理配置供后续使用
        this.proxyConfig = getProxyConfigForProvider(config, 'gemini-antigravity');
    }

    /**
     * 获取 Base URL 降级顺序
     * @param {Object} config - 配置对象
     * @returns {string[]} Base URL 列表
     */
    getBaseURLFallbackOrder(config) {
        // 如果配置了自定义 base_url，只使用该 URL
        if (config.ANTIGRAVITY_BASE_URL) {
            return [config.ANTIGRAVITY_BASE_URL.replace(/\/$/, '')];
        }
        
        // 默认降级顺序：daily -> sandbox -> prod
        return [
            ANTIGRAVITY_SANDBOX_BASE_URL_DAILY,
            ANTIGRAVITY_BASE_URL_DAILY,
            ANTIGRAVITY_BASE_URL_PROD
        ];
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Antigravity] Initializing Antigravity API Service...');
        await this.initializeAuth();

        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            console.log(`[Antigravity] Using provided Project ID: ${this.projectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
        }

        this.isInitialized = true;
        console.log(`[Antigravity] Initialization complete. Project ID: ${this.projectId}`);
    }

    async initializeAuth(forceRefresh = false) {
        // 检查是否需要刷新 Token
        const needsRefresh = forceRefresh || this.isTokenExpiringSoon();

        if (this.authClient.credentials.access_token && !needsRefresh) {
            // Token 有效且不需要刷新
            return;
        }

        // Antigravity 不支持 base64 配置，直接使用文件路径

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
        try {
            const data = await fs.readFile(credPath, "utf8");
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);
            console.log('[Antigravity Auth] Authentication configured successfully from file.');

            if (needsRefresh) {
                console.log('[Antigravity Auth] Token expiring soon or force refresh requested. Refreshing token...');
                const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                this.authClient.setCredentials(newCredentials);
                // 保存刷新后的凭证到文件
                await fs.writeFile(credPath, JSON.stringify(newCredentials, null, 2));
                console.log(`[Antigravity Auth] Token refreshed and saved to ${credPath} successfully.`);
            }
        } catch (error) {
            console.error('[Antigravity Auth] Error initializing authentication:', error.code);
            if (error.code === 'ENOENT' || error.code === 400) {
                console.log(`[Antigravity Auth] Credentials file '${credPath}' not found. Starting new authentication flow...`);
                const newTokens = await this.getNewToken(credPath);
                this.authClient.setCredentials(newTokens);
                console.log('[Antigravity Auth] New token obtained and loaded into memory.');
            } else {
                console.error('[Antigravity Auth] Failed to initialize authentication from file:', error);
                throw new Error(`Failed to load OAuth credentials.`);
            }
        }
    }

    async getNewToken(credPath) {
        // 使用统一的 OAuth 处理方法
        const { authUrl, authInfo } = await handleGeminiAntigravityOAuth(this.config);
        
        console.log('\n[Antigravity Auth] 正在自动打开浏览器进行授权...');
        console.log('[Antigravity Auth] 授权链接:', authUrl, '\n');

        // 自动打开浏览器
        const showFallbackMessage = () => {
            console.log('[Antigravity Auth] 无法自动打开浏览器，请手动复制上面的链接到浏览器中打开');
        };

        if (this.config) {
            try {
                const childProcess = await open(authUrl);
                if (childProcess) {
                    childProcess.on('error', () => showFallbackMessage());
                }
            } catch (_err) {
                showFallbackMessage();
            }
        } else {
            showFallbackMessage();
        }

        // 等待 OAuth 回调完成并读取保存的凭据
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(async () => {
                try {
                    const data = await fs.readFile(credPath, 'utf8');
                    const credentials = JSON.parse(data);
                    if (credentials.access_token) {
                        clearInterval(checkInterval);
                        console.log('[Antigravity Auth] New token obtained successfully.');
                        resolve(credentials);
                    }
                } catch (error) {
                    // 文件尚未创建或无效，继续等待
                }
            }, 1000);

            // 设置超时（5分钟）
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('[Antigravity Auth] OAuth 授权超时'));
            }, 5 * 60 * 1000);
        });
    }

    isTokenExpiringSoon() {
        if (!this.authClient.credentials.expiry_date) {
            return false;
        }
        const currentTime = Date.now();
        const expiryTime = this.authClient.credentials.expiry_date;
        const refreshSkewMs = REFRESH_SKEW * 1000;
        return expiryTime <= (currentTime + refreshSkewMs);
    }

    async discoverProjectAndModels() {
        if (this.projectId) {
            console.log(`[Antigravity] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        console.log('[Antigravity] Discovering Project ID...');
        try {
            const initialProjectId = "";
            // Prepare client metadata
            const clientMetadata = {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: initialProjectId,
            };

            // Call loadCodeAssist to discover the actual project ID
            const loadRequest = {
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            const loadResponse = await this.callApi('loadCodeAssist', loadRequest);

            // Check if we already have a project ID from the response
            if (loadResponse.cloudaicompanionProject) {
                console.log(`[Antigravity] Discovered existing Project ID: ${loadResponse.cloudaicompanionProject}`);
                // 获取可用模型
                await this.fetchAvailableModels();
                return loadResponse.cloudaicompanionProject;
            }

            // If no existing project, we need to onboard
            const defaultTier = loadResponse.allowedTiers?.find(tier => tier.isDefault);
            const tierId = defaultTier?.id || 'free-tier';

            const onboardRequest = {
                tierId: tierId,
                cloudaicompanionProject: initialProjectId,
                metadata: clientMetadata,
            };

            let lroResponse = await this.callApi('onboardUser', onboardRequest);

            // Poll until operation is complete with timeout protection
            const MAX_RETRIES = 30; // Maximum number of retries (60 seconds total)
            let retryCount = 0;

            while (!lroResponse.done && retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                lroResponse = await this.callApi('onboardUser', onboardRequest);
                retryCount++;
            }

            if (!lroResponse.done) {
                throw new Error('Onboarding timeout: Operation did not complete within expected time.');
            }

            const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id || initialProjectId;
            console.log(`[Antigravity] Onboarded and discovered Project ID: ${discoveredProjectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
            return discoveredProjectId;
        } catch (error) {
            console.error('[Antigravity] Failed to discover Project ID:', error.response?.data || error.message);
            console.log('[Antigravity] Falling back to generated Project ID as last resort...');
            const fallbackProjectId = generateProjectID();
            console.log(`[Antigravity] Generated fallback Project ID: ${fallbackProjectId}`);
            // 获取可用模型
            await this.fetchAvailableModels();
            return fallbackProjectId;
        }
    }

    async fetchAvailableModels() {
        console.log('[Antigravity] Fetching available models...');

        for (const baseURL of this.baseURLs) {
            try {
                const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;
                const requestOptions = {
                    url: modelsURL,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': this.userAgent
                    },
                    responseType: 'json',
                    body: JSON.stringify({})
                };

                const res = await this.authClient.request(requestOptions);
                // console.log(`[Antigravity] Raw response from ${baseURL}:`, Object.keys(res.data.models));
                if (res.data && res.data.models) {
                    const models = Object.keys(res.data.models);
                    this.availableModels = models
                        .map(modelName2Alias)
                        .filter(alias => alias !== undefined && alias !== '' && alias !== null)
                        .filter(alias => ANTIGRAVITY_MODELS.includes(alias));

                    console.log(`[Antigravity] Available models: [${this.availableModels.join(', ')}]`);
                    return;
                }
            } catch (error) {
                console.error(`[Antigravity] Failed to fetch models from ${baseURL}:`, error.message);
            }
        }

        console.warn('[Antigravity] Failed to fetch models from all endpoints. Using default models.');
        this.availableModels = ANTIGRAVITY_MODELS;
    }

    async listModels() {
        if (!this.isInitialized) await this.initialize();

        const now = Math.floor(Date.now() / 1000);
        const formattedModels = this.availableModels.map(modelId => {
            const displayName = modelId.split('-').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');

            const modelInfo = {
                name: `models/${modelId}`,
                version: '1.0.0',
                displayName: displayName,
                description: `Antigravity model: ${modelId}`,
                inputTokenLimit: 1024000,
                outputTokenLimit: 65535,
                supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
                object: 'model',
                created: now,
                ownedBy: 'antigravity',
                type: 'antigravity'
            };

            if (modelId.endsWith('-thinking') || modelId.includes('-thinking-')) {
                modelInfo.thinking = {
                    min: 1024,
                    max: 100000,
                    zeroAllowed: false,
                    dynamicAllowed: true
                };
            }

            return modelInfo;
        });

        return { models: formattedModels };
    }

    async callApi(method, body, isRetry = false, retryCount = 0, baseURLIndex = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        if (baseURLIndex >= this.baseURLs.length) {
            throw new Error('All Antigravity base URLs failed');
        }

        const baseURL = this.baseURLs[baseURLIndex];

        try {
            const requestOptions = {
                url: `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': this.userAgent
                },
                responseType: 'json',
                body: JSON.stringify(body)
            };

            const res = await this.authClient.request(requestOptions);
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            console.error(`[Antigravity API] Error calling ${method} on ${baseURL}:`, status, error.message);

            if ((status === 400 || status === 401) && !isRetry) {
                console.log('[Antigravity API] Received 401/400. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                return this.callApi(method, body, true, retryCount, baseURLIndex);
            }

            if (status === 429) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    console.log(`[Antigravity API] Rate limited on ${baseURL}. Trying next base URL...`);
                    return this.callApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[Antigravity API] Rate limited. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.callApi(method, body, isRetry, retryCount + 1, 0);
                }
            }

            // Handle network errors - try next base URL first, then retry with backoff
            if (isNetworkError) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                    console.log(`[Antigravity API] Network error (${errorIdentifier}) on ${baseURL}. Trying next base URL...`);
                    return this.callApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                    console.log(`[Antigravity API] Network error (${errorIdentifier}). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.callApi(method, body, isRetry, retryCount + 1, 0);
                }
            }

            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Antigravity API] Server error ${status}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1, baseURLIndex);
            }

            throw error;
        }
    }

    async * streamApi(method, body, isRetry = false, retryCount = 0, baseURLIndex = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY || 1000;

        if (baseURLIndex >= this.baseURLs.length) {
            throw new Error('All Antigravity base URLs failed');
        }

        const baseURL = this.baseURLs[baseURLIndex];

        try {
            const requestOptions = {
                url: `${baseURL}/${ANTIGRAVITY_API_VERSION}:${method}`,
                method: 'POST',
                params: { alt: 'sse' },
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'User-Agent': this.userAgent
                },
                responseType: 'stream',
                body: JSON.stringify(body)
            };

            const res = await this.authClient.request(requestOptions);

            if (res.status !== 200) {
                let errorBody = '';
                for await (const chunk of res.data) {
                    errorBody += chunk.toString();
                }
                throw new Error(`Upstream API Error (Status ${res.status}): ${errorBody}`);
            }

            yield* this.parseSSEStream(res.data);
        } catch (error) {
            const status = error.response?.status;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查是否为可重试的网络错误
            const isNetworkError = isRetryableNetworkError(error);
            
            console.error(`[Antigravity API] Error during stream ${method} on ${baseURL}:`, status, error.message);

            if ((status === 400 || status === 401) && !isRetry) {
                console.log('[Antigravity API] Received 401/400 during stream. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                yield* this.streamApi(method, body, true, retryCount, baseURLIndex);
                return;
            }

            if (status === 429) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    console.log(`[Antigravity API] Rate limited on ${baseURL}. Trying next base URL...`);
                    yield* this.streamApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                    return;
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[Antigravity API] Rate limited during stream. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    yield* this.streamApi(method, body, isRetry, retryCount + 1, 0);
                    return;
                }
            }

            // Handle network errors - try next base URL first, then retry with backoff
            if (isNetworkError) {
                if (baseURLIndex + 1 < this.baseURLs.length) {
                    const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                    console.log(`[Antigravity API] Network error (${errorIdentifier}) on ${baseURL} during stream. Trying next base URL...`);
                    yield* this.streamApi(method, body, isRetry, retryCount, baseURLIndex + 1);
                    return;
                } else if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    const errorIdentifier = errorCode || errorMessage.substring(0, 50);
                    console.log(`[Antigravity API] Network error (${errorIdentifier}) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    yield* this.streamApi(method, body, isRetry, retryCount + 1, 0);
                    return;
                }
            }

            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Antigravity API] Server error ${status} during stream. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1, baseURLIndex);
                return;
            }

            throw error;
        }
    }

    async * parseSSEStream(stream) {
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        });

        let buffer = [];
        for await (let line of rl) {
            if (line.startsWith('data: ')) {
                // 过滤 usageMetadata（仅在最终块中保留）
                line = filterSSEUsageMetadata(line);
                buffer.push(line.slice(6));
            } else if (line === '' && buffer.length > 0) {
                try {
                    yield JSON.parse(buffer.join('\n'));
                } catch (e) {
                    console.error('[Antigravity Stream] Failed to parse JSON chunk:', buffer.join('\n'));
                }
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            try {
                yield JSON.parse(buffer.join('\n'));
            } catch (e) {
                console.error('[Antigravity Stream] Failed to parse final JSON chunk:', buffer.join('\n'));
            }
        }
    }

    async generateContent(model, requestBody) {
        console.log(`[Antigravity Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not found. Using default model: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        const actualModelName = alias2ModelName(selectedModel);
        // 深拷贝请求体
        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)), actualModelName);
        const isClaudeModel = isClaude(actualModelName);

        // 将处理后的请求体转换为 Antigravity 格式
        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);

        // 设置模型名称为实际模型名
        payload.model = actualModelName;

        // 对于 Claude 模型，使用流式请求然后转换为非流式响应
        if (isClaudeModel) {
            return await this.executeClaudeNonStream(payload);
        }

        const response = await this.callApi('generateContent', payload);
        return toGeminiApiResponse(response.response);
    }

    /**
     * 执行 Claude 非流式请求
     * Claude 模型实际上使用流式请求，然后将结果合并为非流式响应
     * @param {Object} payload - 请求体
     * @returns {Object} 非流式响应
     */
    async executeClaudeNonStream(payload) {
        const chunks = [];
        
        try {
            const stream = this.streamApi('streamGenerateContent', payload);
            for await (const chunk of stream) {
                if (chunk) {
                    chunks.push(JSON.stringify(chunk));
                }
            }
            
            // 将流式响应转换为非流式响应
            const streamData = chunks.join('\n');
            const nonStreamResponse = convertStreamToNonStream(streamData);
            return toGeminiApiResponse(nonStreamResponse.response);
        } catch (error) {
            console.error('[Antigravity] Claude non-stream execution error:', error.message);
            throw error;
        }
    }

    async * generateContentStream(model, requestBody) {
        console.log(`[Antigravity Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        let selectedModel = model;
        if (!this.availableModels.includes(model)) {
            console.warn(`[Antigravity] Model '${model}' not found. Using default model: '${this.availableModels[0]}'`);
            selectedModel = this.availableModels[0];
        }

        const actualModelName = alias2ModelName(selectedModel);
        // 深拷贝请求体
        const processedRequestBody = ensureRolesInContents(JSON.parse(JSON.stringify(requestBody)), actualModelName);

        // 将处理后的请求体转换为 Antigravity 格式
        const payload = geminiToAntigravity(actualModelName, { request: processedRequestBody }, this.projectId);

        // 设置模型名称为实际模型名
        payload.model = actualModelName;

        const stream = this.streamApi('streamGenerateContent', payload);
        for await (const chunk of stream) {
            yield toGeminiApiResponse(chunk.response);
        }
    }

    isExpiryDateNear() {
        try {
            const currentTime = Date.now();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            console.log(`[Antigravity] Expiry date: ${this.authClient.credentials.expiry_date}, Current time: ${currentTime}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${currentTime + cronNearMinutesInMillis}`);
            return this.authClient.credentials.expiry_date <= (currentTime + cronNearMinutesInMillis);
        } catch (error) {
            console.error(`[Antigravity] Error checking expiry date: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取模型配额信息
     * @returns {Promise<Object>} 模型配额信息
     */
    async getUsageLimits() {
        if (!this.isInitialized) await this.initialize();
        
        // 检查 token 是否即将过期，如果是则先刷新
        if (this.isExpiryDateNear()) {
            console.log('[Antigravity] Token is near expiry, refreshing before getUsageLimits request...');
            await this.initializeAuth(true);
        }

        try {
            const modelsWithQuotas = await this.getModelsWithQuotas();
            return modelsWithQuotas;
        } catch (error) {
            console.error('[Antigravity] Failed to get usage limits:', error.message);
            throw error;
        }
    }

    /**
     * 获取带配额信息的模型列表
     * @returns {Promise<Object>} 模型配额信息
     */
    async getModelsWithQuotas() {
        try {
            // 解析模型配额信息
            const result = {
                lastUpdated: Date.now(),
                models: {}
            };

            // 调用 fetchAvailableModels 接口获取模型和配额信息
            for (const baseURL of this.baseURLs) {
                try {
                    const modelsURL = `${baseURL}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`;
                    const requestOptions = {
                        url: modelsURL,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': this.userAgent
                        },
                        responseType: 'json',
                        body: JSON.stringify({ project: this.projectId })
                    };

                    const res = await this.authClient.request(requestOptions);
                    console.log(`[Antigravity] fetchAvailableModels success`);
                    if (res.data && res.data.models) {
                        const modelsData = res.data.models;
                        
                        // 遍历模型数据，提取配额信息
                        for (const [modelId, modelData] of Object.entries(modelsData)) {
                            const aliasName = modelName2Alias(modelId);
                            if (aliasName == null || aliasName === '') continue; // 跳过不支持的模型
                            
                            const modelInfo = {
                                remaining: 0,
                                resetTime: null,
                                resetTimeRaw: null
                            };
                            
                            // 从 quotaInfo 中提取配额信息
                            if (modelData.quotaInfo) {
                                modelInfo.remaining = modelData.quotaInfo.remainingFraction || modelData.quotaInfo.remaining || 0;
                                modelInfo.resetTime = modelData.quotaInfo.resetTime || null;
                                modelInfo.resetTimeRaw = modelData.quotaInfo.resetTime;
                            }
                            
                            result.models[aliasName] = modelInfo;
                        }

                        // 对模型按名称排序
                        const sortedModels = {};
                        Object.keys(result.models).sort().forEach(key => {
                            sortedModels[key] = result.models[key];
                        });
                        result.models = sortedModels;
                        console.log(`[Antigravity] Successfully fetched quotas for ${Object.keys(result.models).length} models`);
                        break; // 成功获取后退出循环
                    }
                } catch (error) {
                    console.error(`[Antigravity] Failed to fetch models with quotas from ${baseURL}:`, error.message);
                }
            }

            return result;
        } catch (error) {
            console.error('[Antigravity] Failed to get models with quotas:', error.message);
            throw error;
        }
    }

}