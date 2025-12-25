# 多语言支持使用指南

## 概述

本项目已实现中英文双语支持，可以通过页面右上角的语言切换按钮在简体中文和英文之间切换。

## 文件结构

```
static/app/
├── i18n.js                 # 多语言配置文件（包含所有翻译）
├── language-switcher.js    # 语言切换组件
└── I18N_GUIDE.md          # 本指南
```

## 如何使用

### 1. 在 HTML 中添加多语言支持

使用 `data-i18n` 属性标记需要翻译的元素：

```html
<!-- 文本内容 -->
<h1 data-i18n="header.title">AIClient2API 管理控制台</h1>

<!-- 按钮文本 -->
<button data-i18n="common.save">保存</button>

<!-- 输入框占位符 -->
<input type="text" data-i18n="config.apiKeyPlaceholder" placeholder="请输入API密钥">

<!-- 带参数的翻译 -->
<span data-i18n="upload.count" data-i18n-params='{"count": "10"}'>共 10 个配置文件</span>
```

### 2. 在 JavaScript 中使用翻译

```javascript
import { t } from './i18n.js';

// 简单翻译
const title = t('header.title');

// 带参数的翻译
const message = t('upload.count', { count: 10 });

// 在 showToast 中使用
showToast(t('common.success'), t('config.saved'), 'success');
```

### 3. 添加新的翻译

在 `i18n.js` 文件中的 `translations` 对象中添加：

```javascript
const translations = {
    'zh-CN': {
        'your.key': '你的中文翻译',
        // ...
    },
    'en-US': {
        'your.key': 'Your English translation',
        // ...
    }
};
```

### 4. 动态内容的翻译

对于动态生成的内容，在创建 DOM 元素时添加 `data-i18n` 属性：

```javascript
const element = document.createElement('div');
element.setAttribute('data-i18n', 'your.translation.key');
element.textContent = t('your.translation.key');
```

## 翻译键命名规范

使用点号分隔的层级结构：

- `header.*` - 页头相关
- `nav.*` - 导航相关
- `dashboard.*` - 仪表盘相关
- `config.*` - 配置相关
- `providers.*` - 提供商相关
- `upload.*` - 上传配置相关
- `usage.*` - 用量查询相关
- `logs.*` - 日志相关
- `common.*` - 通用文本

## 已实现的功能

✅ 自动检测并保存用户语言偏好
✅ 页面刷新后保持语言选择
✅ 动态添加的元素自动翻译
✅ 支持带参数的翻译
✅ 语言切换时实时更新所有文本

## 待完善的部分

由于页面内容较多，以下部分需要继续添加 `data-i18n` 属性：

1. 配置管理页面的表单标签和提示
2. 提供商池管理的详细信息
3. 配置管理的列表项
4. 用量查询的统计信息
5. 实时日志的控制按钮

## 示例：完整的多语言表单

```html
<div class="form-group">
    <label data-i18n="config.apiKey">API密钥</label>
    <input 
        type="password" 
        id="apiKey" 
        class="form-control" 
        data-i18n="config.apiKeyPlaceholder"
        placeholder="请输入API密钥"
    >
</div>
```

对应的翻译配置：

```javascript
'zh-CN': {
    'config.apiKey': 'API密钥',
    'config.apiKeyPlaceholder': '请输入API密钥'
},
'en-US': {
    'config.apiKey': 'API Key',
    'config.apiKeyPlaceholder': 'Please enter API key'
}
```

## 注意事项

1. 所有翻译键必须在两种语言中都存在
2. 参数化翻译使用 `{paramName}` 格式
3. HTML 内容使用 `data-i18n-html` 属性
4. 语言切换会触发 `languageChanged` 事件
5. 新添加的 DOM 元素会自动被翻译系统检测

## 调试

在浏览器控制台中：

```javascript
// 获取当前语言
import { getCurrentLanguage } from './app/i18n.js';
console.log(getCurrentLanguage());

// 手动切换语言
import { setLanguage } from './app/i18n.js';
setLanguage('en-US');