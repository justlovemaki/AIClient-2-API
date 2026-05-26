/**
 * AIClient2API 文档数据与格式化中心 (全量版)
 * 确保命令行 (CLI) 和远程 API 返回完全一致且详尽的数据结果
 */ 

export const HELP_DATA = {
    project: "AIClient2API",
    description: "高性能 AI 模型接口聚合代理服务",
    usage: [
        { mode: "Master (Default)", cmd: "npm start", desc: "多进程模式，支持子进程监控与自动重启" },
        { mode: "Standalone", cmd: "npm run start:standalone", desc: "单进程模式，直接运行 API 服务" },
        { mode: "Dev", cmd: "npm run start:dev", desc: "开发调试模式，开启详细日志" }
    ],
    scripts: [
        { os: "Linux/macOS", file: "./install-and-run.sh", desc: "自动安装依赖并启动" },
        { os: "Windows", file: "install-and-run.bat", desc: "自动安装依赖并启动" }
    ],
    cli_args: [
        { flag: "--host", default: "0.0.0.0", desc: "服务器监听地址" },
        { flag: "--port", default: "3000", desc: "服务器监听端口" },
        { flag: "--api-key", default: "123456", desc: "业务接口身份验证密钥" },
        { flag: "--no-ui", default: "false", desc: "禁用前端管理界面" },
        { flag: "--model-provider", default: "gemini-cli-oauth", desc: "默认模型提供商" },
        { flag: "--system-prompt-file", default: "configs/input_system_prompt.txt", desc: "系统提示词路径" },
        { flag: "--system-prompt-mode", default: "append", desc: "提示词模式 (overwrite/append)" },
        { flag: "--log-prompts", default: "none", desc: "提示词日志模式 (console/file/none)" },
        { flag: "--prompt-log-base-name", default: "prompt_log", desc: "日志文件前缀" },
        { flag: "--request-max-retries", default: "3", desc: "API 请求最大重试次数" },
        { flag: "--cron-near-minutes", default: "15", desc: "Token 自动刷新检查间隔 (分钟)" },
        { flag: "--cron-refresh-token", default: "false", desc: "是否开启令牌自动刷新任务" },
        { flag: "--provider-pools-file", default: "configs/provider_pools.json", desc: "提供商号池配置文件路径" },
        { flag: "--custom-models-file", default: "configs/custom_models.json", desc: "自定义模型映射文件路径" },
        { flag: "--max-error-count", default: "10", desc: "单个账号最大连续错误重置次数" },
        { flag: "--rate-limit-cooldown-enabled", default: "false", desc: "是否启用 429 频率限制冷却" },
        { flag: "--rate-limit-cooldown-ms", default: "30000", desc: "基础冷却时长 (ms)" },
        { flag: "--scheduled-health-check-enabled", default: "false", desc: "是否开启定时自动健康检查" },
        { flag: "--scheduled-health-check-interval", default: "600000", desc: "自动检查间隔时间 (ms)" }
    ],
    remote_docs: [
        { path: "/api/help", desc: "获取启动帮助信息 (JSON/Text)" },
        { path: "/api/example", desc: "获取 API 资源指南 (JSON/Text)" }
    ],
    docker: "docker run -d -p 3000:3000 -v \"$(pwd)/configs:/app/configs\" -v \"$(pwd)/plugins:/app/src/plugins-user\" justlikemaki/aiclient-2-api"
};

export const API_GUIDE_DATA = [
    { group: '1. AI 核心业务接口 (AI Business)', routes: [
        { method: 'POST',   path: '/v1/chat/completions',          desc: 'OpenAI 兼容对话接口 (支持流式)' },
        { method: 'GET',    path: '/v1/models',                   desc: '获取 OpenAI 格式模型列表' },
        { method: 'POST',   path: '/v1/images/generations',       desc: '图片生成 (OpenAI 标准)' },
        { method: 'POST',   path: '/v1/images/edits',             desc: '图片编辑/改图 (OpenAI 标准)' },
        { method: 'POST',   path: '/v1/messages',                 desc: 'Claude 兼容消息接口' },
        { method: 'GET',    path: '/v1beta/models',               desc: 'Gemini 格式模型列表' },
        { method: 'POST',   path: '/v1beta/models/{model}:generateContent', desc: 'Gemini 原生生成' },
        { method: 'POST',   path: '/v1/responses',                desc: 'Codex 专有响应接口' },
        { method: 'POST',   path: '/count_tokens',                desc: 'Token 计数 (Anthropic 格式)' }
    ]},
    { group: '2. 系统状态与鉴权 (System & Auth)', routes: [
        { method: 'POST',   path: '/api/login',                   desc: '管理员登录，获取 Token' },
        { method: 'POST',   path: '/api/admin-password',          desc: '修改管理员登录密码' },
        { method: 'GET',    path: '/api/health',                  desc: '管理端健康检查' },
        { method: 'GET',    path: '/health',                      desc: '基础健康检查' },
        { method: 'GET',    path: '/api/system',                  desc: '服务器运行状态统计' },
        { method: 'GET',    path: '/api/service-mode',            desc: '获取运行模式 (Standalone/Master)' },
        { method: 'GET',    path: '/api/access-info',             desc: '获取 API 接入配置与账号状态汇总' }
    ]},
    { group: '3. 配置管理与维护 (Configuration)', routes: [
        { method: 'GET',    path: '/api/config',                  desc: '获取全量配置内容' },
        { method: 'POST',   path: '/api/config',                  desc: '动态更新系统配置' },
        { method: 'POST',   path: '/api/reload-config',           desc: '热加载配置文件' },
        { method: 'POST',   path: '/api/restart-service',         desc: '重启 Worker 服务进程' },
        { method: 'GET',    path: '/api/events',                  desc: 'SSE 实时系统日志推送' },
        { method: 'GET',    path: '/api/system/download-log',     desc: '下载今日系统日志' },
        { method: 'POST',   path: '/api/system/clear-log',        desc: '清除今日运行日志' }
    ]},
    { group: '4. 提供商账号池管理 (Provider Pool)', routes: [
        { method: 'GET',    path: '/api/providers',               desc: '获取所有提供商及账号状态汇总' },
        { method: 'POST',   path: '/api/providers',               desc: '新增提供商账号配置' },
        { method: 'GET',    path: '/api/providers/supported',     desc: '获取系统支持的模型提供商类型' },
        { method: 'GET',    path: '/api/providers/{type}',        desc: '获取指定类型的账号池列表' },
        { method: 'PUT',    path: '/api/providers/{type}/{uuid}', desc: '更新指定账号的详细配置' },
        { method: 'DELETE', path: '/api/providers/{type}/{uuid}', desc: '从账号池中删除特定账号' },
        { method: 'DELETE', path: '/api/providers/{type}/delete-unhealthy', desc: '删除该类型下所有不健康的账号' },
        { method: 'POST',   path: '/api/providers/{type}/health-check', desc: '触发该类型下所有账号的健康检查' },
        { method: 'POST',   path: '/api/providers/{type}/{uuid}/health-check', desc: '触发单个账号的健康检查' },
        { method: 'POST',   path: '/api/providers/{type}/reset-health', desc: '重置该类型下所有账号的健康状态' },
        { method: 'POST',   path: '/api/providers/{type}/{uuid}/detect-models', desc: '探测特定账号支持的模型列表' },
        { method: 'POST',   path: '/api/providers/{type}/refresh-unhealthy-uuids', desc: '刷新该类型下所有不健康账号的 UUID' },
        { method: 'POST',   path: '/api/providers/{type}/{uuid}/enable', desc: '启用特定的账号节点' },
        { method: 'POST',   path: '/api/providers/{type}/{uuid}/disable', desc: '禁用特定的账号节点' },
        { method: 'POST',   path: '/api/providers/{type}/{uuid}/refresh-uuid', desc: '刷新特定账号的 UUID' },
        { method: 'GET',    path: '/api/provider-models',         desc: '获取所有已配置账号支持的模型汇总' },
        { method: 'GET',    path: '/api/usage',                   desc: '获取全量提供商配额使用统计' },
        { method: 'GET',    path: '/api/usage/supported-providers', desc: '获取支持配额查询的提供商列表' },
        { method: 'GET',    path: '/api/usage/{type}',            desc: '获取指定提供商类型的配额详情' },
        { method: 'GET',    path: '/provider_health',             desc: '账号池整体健康度聚合统计' }
    ]},
    { group: '5. 凭据管理与自动化工具 (Credentials)', routes: [
        { method: 'GET',    path: '/api/upload-configs',          desc: '列出 configs 目录下的所有配置文件' },
        { method: 'POST',   path: '/api/upload-oauth-credentials', desc: '上传新的 OAuth 凭据 (JSON)' },
        { method: 'GET',    path: '/api/upload-configs/view/{file}', desc: '查看特定凭据文件的内容' },
        { method: 'GET',    path: '/api/upload-configs/download/{file}', desc: '下载特定的凭据文件' },
        { method: 'DELETE', path: '/api/upload-configs/delete/{file}', desc: '删除特定的凭据文件' },
        { method: 'DELETE', path: '/api/upload-configs/delete-unbound', desc: '清理未被账号池绑定的凭据文件' },
        { method: 'GET',    path: '/api/upload-configs/download-all', desc: '打包下载所有配置文件 (ZIP)' },
        { method: 'POST',   path: '/api/quick-link-provider',     desc: '自动将本地凭据关联到账号池' },
        { method: 'POST',   path: '/api/oauth/manual-callback',   desc: '手动提交 OAuth 授权回调数据' },
        { method: 'POST',   path: '/api/providers/{type}/generate-auth-url', desc: '生成 OAuth 授权引导链接' },
        { method: 'POST',   path: '/api/kiro/import-aws-credentials', desc: '导入 AWS SSO 凭据 (Kiro)' },
        { method: 'POST',   path: '/api/{type}/batch-import-tokens', desc: '批量导入 Refresh Tokens (SSE 模式)' }
    ]},
    { group: '6. 插件、更新与扩展 (Plugin & Update)', routes: [
        { method: 'GET',    path: '/api/plugins',                 desc: '列出系统已加载的所有插件' },
        { method: 'POST',   path: '/api/plugins/{name}/toggle',   desc: '启用或禁用特定的插件' },
        { method: 'GET',    path: '/api/custom-models',           desc: '获取已配置的自定义模型映射' },
        { method: 'POST',   path: '/api/custom-models',           desc: '新增自定义模型映射规则' },
        { method: 'PUT',    path: '/api/custom-models/{id}',      desc: '更新指定的模型映射规则' },
        { method: 'DELETE', path: '/api/custom-models/{id}',      desc: '删除指定的模型映射规则' },
        { method: 'GET',    path: '/api/check-update',            desc: '检查 GitHub 仓库的远程更新' },
        { method: 'POST',   path: '/api/update',                  desc: '执行系统版本自动更新' }
    ]},
    { group: '7. 远程文档与自发现接口 (Remote Docs)', routes: [
        { method: 'GET',    path: '/api/help',                    desc: '获取启动帮助信息 (JSON/Text)' },
        { method: 'GET',    path: '/api/example',                 desc: '获取 API 资源指南 (JSON/Text)' }
    ]}
];

export const API_EXAMPLES = {
    ai_api: `
/**
 * 示例 1: 调用 AI 业务接口 (如对话)
 * 授权: 使用静态配置的 API Key
 */
async function chat(prompt) {
    const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer 123456' // 替换为你的 --api-key
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }]
        })
    });
    return await res.json();
}`,
    management_api: `
/**
 * 示例 2: 调用管理后台接口 (如修改配置)
 * 授权: 先通过 login 获取动态 Token
 */
async function updateConfig(newConfig) {
    // 1. 获取管理员 Token
    const auth = await fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: '你的管理员密码' })
    });
    const { token } = await auth.json();

    // 2. 带上 Token 调用管理 API
    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Authorization': \`Bearer \${token}\` },
        body: JSON.stringify(newConfig)
    });
}`
};

/**
 * 格式化帮助信息为文本 (用于 CLI)
 */
export function formatHelpText(data = HELP_DATA) {
    let output = `\n\x1b[1m\x1b[35m${data.project} - ${data.description}\x1b[0m\n`;
    output += `\n\x1b[36m[ 用法 / Usage ]\x1b[0m\n`;
    data.usage.forEach(u => {
        output += `  ${u.cmd.padEnd(30)} | ${u.desc}\n`;
    });
    output += `\n\x1b[36m[ 启动脚本 / Scripts ]\x1b[0m\n`;
    data.scripts.forEach(s => {
        output += `  ${s.file.padEnd(30)} | (${s.os}) ${s.desc}\n`;
    });
    output += `\n\x1b[36m[ 配置参数 / Arguments ]\x1b[0m\n`;
    data.cli_args.forEach(a => {
        output += `  ${a.flag.padEnd(30)} | 默认: ${a.default.padEnd(15)} | ${a.desc}\n`;
    });
    output += `\n\x1b[36m[ Docker 启动 ]\x1b[0m\n  ${data.docker}\n`;
    output += `\n\x1b[36m[ 远程文档 API ]\x1b[0m\n`;
    data.remote_docs.forEach(d => {
        output += `  GET ${d.path.padEnd(26)} | ${d.desc}\n`;
    });
    return output;
}

/**
 * 格式化 API 指南为文本 (用于 CLI)
 */
export function formatApiGuideText(data = API_GUIDE_DATA, examples = API_EXAMPLES) {
    let output = `\n\x1b[1m\x1b[35mAIClient2API 全量 API 资源指南\x1b[0m\n`;
    data.forEach(g => {
        output += `\n\x1b[36m[ ${g.group} ]\x1b[0m\n`;
        g.routes.forEach(r => {
            output += `  \x1b[32m${r.method.padEnd(10)}\x1b[0m ${r.path.padEnd(45)} | ${r.desc}\n`;
        });
    });

    output += `\n\x1b[33m${'='.repeat(100)}\x1b[0m\n`;
    output += `\x1b[1m\x1b[33m                    前端调用代码实现示例\x1b[0m\n`;
    output += `\x1b[33m${'='.repeat(100)}\x1b[0m\n`;
    output += examples.ai_api + `\n`;
    output += `\x1b[33m${'-'.repeat(100)}\x1b[0m\n`;
    output += examples.management_api + `\n`;

    return output;
}

