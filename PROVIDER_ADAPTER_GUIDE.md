# AIClient2API Provider 接入指南

本文档详细说明了如何向 AIClient2API 项目接入全新的模型提供商（Provider），涵盖从后端核心逻辑到前端 UI 管理的全流程调整。

## 1. 接入流程概览

1.  **后端常量定义**：在 `src/utils/common.js` 中添加标识。
2.  **核心 Service 开发**：在 `src/providers/` 实现 API 请求逻辑。
3.  **适配器注册**：在 `src/providers/adapter.js` 注册。
4.  **模型与号池配置**：在 `src/providers/provider-models.js` 和 `src/providers/provider-pool-manager.js` 配置。
5.  **前端 UI 全方位调整**：
    *   `static/app/provider-manager.js`：号池显示与顺序。
    *   `static/app/file-upload.js`：上传路径映射。
    *   `static/components/section-config.html`：配置按钮。
    *   `static/components/section-guide.html`：使用指南。
6.  **系统级映射（必做）**：在 OAuth 处理器、凭据关联工具、用量统计等模块中建立映射。

---

## 2. 后端核心实现

### 2.1 定义常量
修改 [`src/utils/common.js`](src/utils/common.js)，在 `MODEL_PROVIDER` 中添加新 key（格式建议：`协议-名称-类型`）。

### 2.2 核心 Service (Core)
在 `src/providers/` 下创建新目录并实现 `NewProviderApiService` 类。
**必选方法**：`constructor(config)`, `initialize()`, `listModels()`, `generateContent()`, `generateContentStream()`。

### 2.3 注册适配器
在 [`src/providers/adapter.js`](src/providers/adapter.js) 中继承 `ApiServiceAdapter`，并在 `getServiceAdapter` 工厂方法中添加 `switch` 分支。

### 2.4 模型与号池默认配置
*   **模型列表**：在 [`src/providers/provider-models.js`](src/providers/provider-models.js) 的 `PROVIDER_MODELS` 对象中添加默认支持的模型 ID。
*   **健康检查默认值**：在 [`src/providers/provider-pool-manager.js`](src/providers/provider-pool-manager.js) 的 `DEFAULT_HEALTH_CHECK_MODELS` 中指定用于健康检查的默认模型。

---

## 3. 前端界面调整

### 3.1 号池显示逻辑 ([`static/app/provider-manager.js`](static/app/provider-manager.js))
*   **显示顺序**：将新标识添加到 `providerDisplayOrder` 数组。
*   **授权按钮**：若支持 OAuth，在 `generateAuthButton` 的 `oauthProviders` 数组中添加标识。
*   **路径提示**：在 `getAuthFilePath` 中返回凭据文件的默认建议路径。

### 3.2 凭据上传路由 ([`static/app/file-upload.js`](static/app/file-upload.js))
*   修改 `getProviderKey`，建立提供商标识与 `configs/` 子目录名的映射（例如：`new-provider-api` -> `new-provider`）。

### 3.3 凭据文件管理筛选器
需要在以下三个位置添加新提供商的筛选支持：

#### 3.3.1 HTML 筛选器选项 ([`static/components/section-upload-config.html`](static/components/section-upload-config.html))
在 `id="configProviderFilter"` 的 `<select>` 元素中添加新的 `<option>`：
```html
<option value="new-provider-type" data-i18n="upload.providerFilter.newProvider">New Provider OAuth</option>
```

#### 3.3.2 JavaScript 提供商映射 ([`static/app/upload-config-manager.js`](static/app/upload-config-manager.js))
在 `detectProviderFromPath()` 函数的 `providerMappings` 数组中添加映射关系：
```javascript
{
    patterns: ['configs/new-provider/', '/new-provider/'],
    providerType: 'new-provider-type',
    displayName: 'New Provider OAuth',
    shortName: 'new-provider-oauth'
}
```

#### 3.3.3 多语言文案 ([`static/app/i18n.js`](static/app/i18n.js))
在中文和英文的翻译对象中添加筛选器文案：
```javascript
// 中文版本 (zh-CN)
'upload.providerFilter.newProvider': 'New Provider OAuth',

// 英文版本 (en-US)
'upload.providerFilter.newProvider': 'New Provider OAuth',
```

### 3.4 配置管理界面 ([`static/components/section-config.html`](static/components/section-config.html))
*   **必须添加**：在 `id="modelProvider"`（初始化提供商选择）容器中添加对应的 `provider-tag` 按钮。
*   **可选添加**：在 `id="proxyProviders"`（代理开关）中同步添加。

### 3.5 指南与教程 ([`static/components/section-guide.html`](static/components/section-guide.html))
*   在"项目简介"和"客户端配置指南"中添加新提供商的调用示例（如 `{provider}/v1/chat/completions`）。

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

### 4.4 OAuth 处理器 ([`src/ui-modules/oauth-api.js`](src/ui-modules/oauth-api.js))
若支持 OAuth，需在 `handleGenerateAuthUrl` 中分发到相应的认证处理器。

---

## 5. 注意事项
1.  **协议对齐**：本项目内部默认使用 Gemini 协议。若上游为 OpenAI 协议，需在 `src/convert/` 实现转换。
2.  **安全**：不要在 Core 代码中硬编码 Key，始终从 `config` 中读取动态注入的凭据。
3.  **异常捕获**：Core 代码必须抛出标准错误（包含 status），以便号池管理器识别并自动隔离失效账号。
