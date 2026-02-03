# AIClient2API Provider 接入指南

本文档详细说明了如何向 AIClient2API 项目接入全新的模型提供商（Provider），涵盖从后端核心逻辑到前端 UI 管理的全流程调整。

## 1. 接入流程概览

1.  **后端常量定义**：在 `src/utils/common.js` 中添加标识。
2.  **核心 Service 开发**：在 `src/providers/` 实现 API 请求逻辑。
3.  **适配器注册**：在 `src/providers/adapter.js` 注册并实现适配器类。
4.  **模型与号池配置**：在 `src/providers/provider-models.js` 和 `src/providers/provider-pool-manager.js` 配置。
5.  **前端 UI 全方位调整**：
    *   `static/app/provider-manager.js`：号池显示与顺序。
    *   `static/app/file-upload.js`：上传路径映射。
    *   `static/app/modal.js`：配置字段显示顺序。
    *   `static/app/utils.js`：定义配置字段元数据。
    *   `static/components/section-config.html`：配置按钮。
    *   `static/components/section-guide.html`：使用指南。
    *   `static/app/routing-examples.js`：路由调用示例。
    *   `src/handlers/ollama-handler.js`：Ollama 协议前缀与支持映射。
6.  **系统级映射（必做）**：在 OAuth 处理器、凭据关联工具、用量统计等模块中建立映射。

---

## 2. 后端核心实现

### 2.1 定义常量
修改 [`src/utils/common.js`](src/utils/common.js)，在 `MODEL_PROVIDER` 中添加新 key（格式建议：`协议-名称-类型`）。

### 2.2 核心 Service (Core)
在 `src/providers/` 下创建新目录并实现 `NewProviderApiService` 类。
**必选方法**：`constructor(config)`, `initialize()`, `listModels()`, `generateContent()`, `generateContentStream()`。
**可选功能**：若支持用量查询，需实现 `getUsageLimits()`；若支持 Token 统计，需实现 `countTokens()`。

### 2.3 注册适配器
在 [`src/providers/adapter.js`](src/providers/adapter.js) 中：
1. 继承 `ApiServiceAdapter` 实现特定提供商的适配器类。
2. 适配器类需按需重写 `generateContent`, `generateContentStream`, `listModels`, `getUsageLimits`, `countTokens`, `refreshToken` 等方法，并转发给核心 Service。
3. 在 `getServiceAdapter` 工厂方法中添加对应的 `switch` 分支，根据 `MODEL_PROVIDER` 返回实例。

### 2.4 模型与号池默认配置
*   **模型列表**：在 [`src/providers/provider-models.js`](src/providers/provider-models.js) 的 `PROVIDER_MODELS` 对象中添加默认支持的模型 ID。
*   **健康检查默认值**：在 [`src/providers/provider-pool-manager.js`](src/providers/provider-pool-manager.js) 的以下位置配置：
    *   `DEFAULT_HEALTH_CHECK_MODELS`：指定用于健康检查的默认模型。
    *   `checkAndRefreshExpiringNodes`：指定凭据文件路径键名。
    *   `_buildHealthCheckRequests`：若有特殊请求格式需求，需在此添加逻辑。

---

## 3. 前端界面调整

### 3.1 字段定义与元数据 ([`static/app/utils.js`](static/app/utils.js))
在 `getProviderTypeFields` 函数中定义该提供商所需的配置字段（如 API Key, Base URL, 凭据路径等），指定字段类型和占位符。

### 3.2 字段显示顺序 ([`static/app/modal.js`](static/app/modal.js))
在 `getFieldOrder` 函数的 `fieldOrderMap` 中添加新提供商的字段显示顺序。

### 3.3 号池显示逻辑 ([`static/app/provider-manager.js`](static/app/provider-manager.js))
*   **显示顺序**：将新标识和显示名称添加到 `providerConfigs` 数组。
*   **授权按钮**：若支持 OAuth，在 `generateAuthButton` 的 `oauthProviders` 数组中添加标识。
*   **认证逻辑**：若支持 OAuth 或批量导入，需在 `handleGenerateAuthUrl` 中实现相应的触发逻辑（如弹出认证方式选择器）。

### 3.4 凭据上传路由 ([`static/app/file-upload.js`](static/app/file-upload.js))
*   修改 `getProviderKey`，建立提供商标识与 `configs/` 子目录名的映射（例如：`new-provider-api` -> `new-provider`）。

### 3.5 凭据文件管理筛选器
需要在以下三个位置添加新提供商的筛选支持：

#### 3.5.1 HTML 筛选器选项 ([`static/components/section-upload-config.html`](static/components/section-upload-config.html))
在 `id="configProviderFilter"` 的 `<select>` 元素中添加新的 `<option>`：
```html
<option value="new-provider-type" data-i18n="upload.providerFilter.newProvider">New Provider OAuth</option>
```

#### 3.5.2 JavaScript 提供商映射 ([`static/app/upload-config-manager.js`](static/app/upload-config-manager.js))
在 `detectProviderFromPath()` 函数的 `providerMappings` 数组中添加映射关系：
```javascript
{
    patterns: ['configs/new-provider/', '/new-provider/'],
    providerType: 'new-provider-type',
    displayName: 'New Provider OAuth',
    shortName: 'new-provider-oauth'
}
```

#### 3.5.3 多语言文案 ([`static/app/i18n.js`](static/app/i18n.js))
在中文和英文的翻译对象中添加筛选器、配置项、认证步骤等相关文案：
```javascript
// 中文版本 (zh-CN)
'upload.providerFilter.newProvider': 'New Provider OAuth',
'config.newProvider.apiKey': 'API 密钥',

// 英文版本 (en-US)
'upload.providerFilter.newProvider': 'New Provider OAuth',
'config.newProvider.apiKey': 'API Key',
```

### 3.6 配置管理界面 ([`static/components/section-config.html`](static/components/section-config.html))
*   **必须添加**：在 `id="modelProvider"`（初始化提供商选择）容器中添加对应的 `provider-tag` 按钮。
*   **可选添加**：在 `id="proxyProviders"`（代理开关）中同步添加。

### 3.7 路由调用示例 ([`static/app/routing-examples.js`](static/app/routing-examples.js))
在 `routingConfigs` 数组中添加该提供商的路径定义，并在 `generateCurlExample` 中处理协议转换逻辑说明。

### 3.8 指南与教程 ([`static/components/section-guide.html`](static/components/section-guide.html))
*   在"支持的模型提供商"中添加新提供商的介绍和支持情况（Badge）。
*   在"客户端配置指南"中补充该提供商的调用路径提示。

---

## 4. 全局系统映射 (关键)

为确保新提供商的功能完整（如多账号自动切换、用量监控），**必须**在以下位置建立映射：

### 4.1 凭据路径键名映射 ([`src/services/service-manager.js`](src/services/service-manager.js))
在 `getServiceAdapter` 逻辑相关的 `credPathKey` 映射中，指定该提供商对应的配置文件路径键名。

### 4.2 自动关联工具 ([`src/utils/provider-utils.js`](src/utils/provider-utils.js))
在 `CONFIG_FILE_PATTERNS` 数组中添加配置，以便系统能根据文件路径自动识别并关联凭据：
```javascript
{
    patterns: ['configs/new-dir/', '/new-dir/'],
    providerType: 'new-provider-api',
    credPathKey: 'NEW_PROVIDER_CREDS_FILE_PATH'
}
```

### 4.3 用量统计映射 ([`src/ui-modules/usage-api.js`](src/ui-modules/usage-api.js))
*   将标识添加到 `supportedProviders` 数组。
*   在 `credPathKey` 映射中添加路径键名，以便前端能展示每个账号的配额/用量。
*   在 `getAdapterUsage` 中根据需要处理原始数据的格式化。

### 4.4 OAuth 处理器
*   **处理器逻辑**：在 `src/auth/oauth-handlers.js` 中导出处理函数。
*   **路由分发**：在 [`src/ui-modules/oauth-api.js`](src/ui-modules/oauth-api.js) 的 `handleGenerateAuthUrl` 中分发到相应的处理器。
*   **回调处理**：若涉及 HTTP 回调，需在 `src/auth/` 下实现回调服务器逻辑。

### 4.5 Ollama 协议映射 ([`src/handlers/ollama-handler.js`](src/handlers/ollama-handler.js))
*   在 `MODEL_PREFIX_MAP` 中添加该提供商对应的日志/显示前缀。
*   在 `supportedProviders` 数组中添加该提供商标识，以支持 Ollama 协议转换。

---

## 5. 注意事项
1.  **协议对齐**：本项目内部默认使用 Gemini 协议。若上游为 OpenAI 协议，需在 `src/convert/` 实现转换，或在 Core Service 中自行处理。
2.  **安全性**：不要在 Core 代码中硬编码 Key，始终从 `config` 中读取动态注入的凭据。
3.  **异常捕获**：Core 代码必须抛出标准错误（包含 status），以便号池管理器识别并自动隔离失效账号。401/403 错误通常触发 UUID 刷新或凭据切换。
4.  **异步刷新**：利用 V2 架构的读写分离，耗时的认证逻辑应放入 `refreshToken` 并在后台异步执行。
