// 多语言配置
const translations = {
    'zh-CN': {
        // Header
        'header.title': 'AIClient2API 管理控制台',
        'header.description': 'AIClient2API 管理控制台 - 统一管理 AI 服务提供商',
        'header.github': 'GitHub 仓库',
        'header.themeToggle': '切换主题',
        'header.status.connecting': '连接中...',
        'header.status.connected': '已连接',
        'header.status.disconnected': '连接断开',
        'header.logout': '登出',
        'header.reload': '重载',
        'header.reload.confirm': '确定要重载配置吗？这将重新加载所有配置文件。',
        'header.reload.requesting': '正在重载配置...',
        'header.reload.success': '配置重载成功',
        'header.reload.failed': '配置重载失败',
        'header.refresh': '重载',
        'header.restart': '重启',
        'header.restart.confirm': '确定要重启服务吗？服务将短暂中断。',
        'header.restart.requesting': '正在请求重启服务...',
        'header.restart.success': '重启请求已发送，服务即将重启',
        'header.restart.reconnecting': '正在重新连接...',
        'header.restart.failed': '重启服务失败',
        
        // Navigation
        'nav.main': '主导航',
        'nav.dashboard': '仪表盘',
        'nav.config': '配置管理',
        'nav.providers': '提供商池管理',
        'nav.upload': '配置管理',
        'nav.usage': '用量查询',
        'nav.logs': '实时日志',
        'nav.plugins': '插件管理',
        
        // Dashboard
        'dashboard.title': '系统概览',
        'dashboard.uptime': '运行时间',
        'dashboard.systemInfo': '系统信息',
        'dashboard.version': '版本号',
        'dashboard.update.check': '检查更新',
        'dashboard.update.checkTitle': '检查是否有新版本可用',
        'dashboard.update.perform': '立即更新',
        'dashboard.update.performTitle': '更新到最新版本',
        'dashboard.update.checking': '正在检查...',
        'dashboard.update.upToDate': '已是最新',
        'dashboard.update.hasUpdate': '发现新版本: {version}',
        'dashboard.update.updating': '正在更新...',
        'dashboard.update.success': '更新成功',
        'dashboard.update.needsRestart': '代码已更新，请点击右上角「重启」按钮使更改生效',
        'dashboard.update.restartTitle': '更新完成',
        'dashboard.update.restartMsg': '代码已更新到版本 {version}，请点击页面右上角的「重启」按钮使新代码生效。',
        'dashboard.update.failed': '更新失败: {error}',
        'dashboard.update.confirmTitle': '确认更新',
        'dashboard.update.confirmMsg': '确定要更新到版本 {version} 吗？更新期间服务可能会短暂不可用。',
        'dashboard.nodeVersion': 'Node.js版本',
        'dashboard.serverTime': '服务器时间',
        'dashboard.memoryUsage': '内存使用',
        'dashboard.cpuUsage': 'CPU 使用',
        'dashboard.serviceMode': '运行模式',
        'dashboard.serviceMode.worker': '子进程模式',
        'dashboard.serviceMode.standalone': '独立模式',
        'dashboard.serviceMode.canRestart': '支持自动重启',
        'dashboard.processPid': '进程 PID',
        'dashboard.platform': '操作系统',
        'dashboard.routing.title': '路径路由调用示例',
        'dashboard.routing.description': '通过不同路径路由访问不同的AI模型提供商，支持灵活的模型切换',
        'dashboard.routing.oauth': '突破限制',
        'dashboard.routing.official': '官方API/三方',
        'dashboard.routing.experimental': '突破限制/实验性',
        'dashboard.routing.free': '突破限制/免费使用',
        'dashboard.routing.endpoint': '端点路径:',
        'dashboard.routing.example': '使用示例',
        'dashboard.routing.exampleOpenAI': '使用示例 (OpenAI格式):',
        'dashboard.routing.exampleClaude': '使用示例 (Claude格式):',
        'dashboard.routing.openai': 'OpenAI协议',
        'dashboard.routing.claude': 'Claude协议',
        'dashboard.routing.tips': '使用提示',
        'dashboard.routing.tip1': '即时切换: 通过修改URL路径即可切换不同的AI模型提供商',
        'dashboard.routing.tip2': '客户端配置: 在Cherry-Studio、NextChat、Cline等客户端中设置API端点为对应路径',
        'dashboard.routing.tip3': '跨协议调用: 支持OpenAI协议调用Claude模型，或Claude协议调用OpenAI模型',
        'dashboard.routing.nodeName.gemini': 'Gemini CLI OAuth',
        'dashboard.routing.nodeName.antigravity': 'Gemini Antigravity',
        'dashboard.routing.nodeName.claude': 'Claude Custom',
        'dashboard.routing.nodeName.kiro': 'Claude Kiro OAuth',
        'dashboard.routing.nodeName.openai': 'OpenAI Custom',
        'dashboard.routing.nodeName.qwen': 'Qwen OAuth',
        'dashboard.routing.nodeName.iflow': 'iFlow OAuth',
        'dashboard.contact.title': '联系与赞助',
        'dashboard.contact.wechat': '扫码进群，注明来意',
        'dashboard.contact.wechatDesc': '添加微信获取更多技术支持和交流',
        'dashboard.contact.x': '关注 X.com',
        'dashboard.contact.xDesc': '在 X 上关注我们获取最新动态',
        'dashboard.contact.sponsor': '扫码赞助',
        'dashboard.contact.sponsorDesc': '您的赞助是项目持续发展的动力',
        'dashboard.contact.coffee': 'Buy me a coffee',
        'dashboard.contact.coffeeDesc': 'If you like this project, buy me a coffee!',
        
        // OAuth
        'oauth.modal.title': 'OAuth 授权',
        'oauth.modal.provider': '提供商:',
        'oauth.modal.requiredPort': '需要开放端口:',
        'oauth.modal.portNote': '请确保此端口可被外部访问，用于接收授权回调',
        'oauth.modal.steps': '授权步骤：',
        'oauth.modal.step1': '点击下方按钮在浏览器中打开授权页面',
        'oauth.modal.step2.qwen': '完成授权后，系统会自动获取凭据文件',
        'oauth.modal.step2.google': '使用您的Google账号登录并授权',
        'oauth.modal.step3': '凭据文件可在上传配置管理中查看和管理',
        'oauth.modal.step4.qwen': '授权有效期: {min} 分钟',
        'oauth.modal.step4.google': '授权完成后，凭据文件会自动保存',
        'oauth.modal.urlLabel': '授权链接:',
        'oauth.modal.copyTitle': '复制链接',
        'oauth.modal.openInBrowser': '在浏览器中打开',
        'oauth.manual.title': '自动监听受阻？',
        'oauth.manual.desc': '如果授权窗口重定向后显示“无法访问”，请将该窗口地址栏的 <strong>完整 URL</strong> 粘贴到下方：',
        'oauth.manual.placeholder': '粘贴回调 URL (包含 code=...)',
        'oauth.manual.submit': '提交',
        'oauth.success.msg': '授权链接已复制到剪贴板',
        'oauth.window.blocked': '授权窗口被浏览器拦截，请允许弹出窗口',
        'oauth.window.opened': '已打开授权窗口，请在窗口中完成操作',
        'oauth.processing': '正在完成授权...',
        'oauth.invalid.url': '该 URL 似乎不包含有效的授权代码',
        'oauth.error.format': '无效的 URL 格式',
        'oauth.kiro.selectMethod': '选择认证方式',
        'oauth.kiro.google': 'Google 账号登录',
        'oauth.kiro.googleDesc': '使用 Google 账号进行社交登录',
        'oauth.kiro.github': 'GitHub 账号登录',
        'oauth.kiro.githubDesc': '使用 GitHub 账号进行社交登录',
        'oauth.kiro.awsBuilder': 'AWS Builder ID',
        'oauth.kiro.awsBuilderDesc': '使用 AWS Builder ID 进行设备码授权',
        'oauth.kiro.authMethodLabel': '认证方式:',
        'oauth.kiro.step1': '点击下方按钮在浏览器中打开授权链接',
        'oauth.kiro.step2': '使用您的 {method} 账号登录',
        'oauth.kiro.step3': '授权完成后页面会自动关闭',
        'oauth.kiro.step4': '刷新本页面查看凭据文件',
        'oauth.kiro.batchImport': '批量导入 refreshToken',
        'oauth.kiro.batchImportDesc': '批量导入已有的 refreshToken 生成凭据文件，该模式不支持 AWS 账号。',
        'oauth.kiro.batchImportInstructions': '请输入 refreshToken，每行一个。系统将自动刷新并生成凭据文件。',
        'oauth.kiro.awsImport': '导入 AWS 账号',
        'oauth.kiro.awsImportDesc': '从 AWS SSO cache 目录导入凭据文件，适用于 AWS Builder ID 模式。',
        'oauth.kiro.awsImportInstructions': '请上传 AWS SSO cache 目录中的 JSON 文件，需包含 clientId、clientSecret、accessToken、refreshToken 四个字段。',
        'oauth.kiro.awsModeFile': '文件上传',
        'oauth.kiro.awsModeJson': 'JSON 粘贴',
        'oauth.kiro.awsUploadFiles': '上传凭据文件',
        'oauth.kiro.awsDragDrop': '拖拽文件到此处',
        'oauth.kiro.awsClickUpload': '或点击选择文件',
        'oauth.kiro.awsFileHint': '如果一个文件不包含全部字段，可以多次上传不同的文件进行补全',
        'oauth.kiro.awsSelectedFiles': '已选择的文件',
        'oauth.kiro.awsClearFiles': '清空全部',
        'oauth.kiro.awsFileReplaced': '已替换同名文件: {filename}',
        'oauth.kiro.awsJsonInput': '粘贴 JSON 凭据',
        'oauth.kiro.awsJsonPlaceholderSimple': '在此粘贴包含 clientId、clientSecret、accessToken、refreshToken 的 JSON...',
        'oauth.kiro.awsJsonExample': '查看 JSON 格式示例',
        'oauth.kiro.awsJsonHint': '可以直接粘贴合并后的 JSON，或从 AWS SSO cache 文件复制内容',
        'oauth.kiro.awsJsonParseError': 'JSON 格式错误',
        'oauth.kiro.awsParseError': '解析文件 {filename} 失败',
        'oauth.kiro.awsValidationSuccess': '验证通过！已找到全部必需字段',
        'oauth.kiro.awsValidationFailed': '验证失败！缺少必需字段',
        'oauth.kiro.awsMissingFields': '缺少 {count} 个字段',
        'oauth.kiro.awsUploadMore': '请上传包含缺失字段的文件，或切换到 JSON 模式手动补全',
        'oauth.kiro.awsPreviewJson': '合并后的凭据预览',
        'oauth.kiro.awsConfirmImport': '确认导入',
        'oauth.kiro.awsNoCredentials': '没有可导入的凭据',
        'oauth.kiro.awsImporting': '正在导入...',
        'oauth.kiro.awsImportSuccess': 'AWS 凭据导入成功！',
        'oauth.kiro.awsImportFailed': 'AWS 凭据导入失败',
        'oauth.kiro.refreshTokensLabel': 'RefreshToken 列表',
        'oauth.kiro.refreshTokensPlaceholder': '每行输入一个 refreshToken\n例如:\naorAxxxxxxxx\naorAyyyyyyyy\naorAzzzzzzzz',
        'oauth.kiro.tokenCount': '待导入数量:',
        'oauth.kiro.importing': '正在导入中，请稍候...',
        'oauth.kiro.importingProgress': '正在导入 {current}/{total}...',
        'oauth.kiro.startImport': '开始导入',
        'oauth.kiro.noTokens': '请输入至少一个 refreshToken',
        'oauth.kiro.importSuccess': '导入成功！共 {count} 个凭据已生成',
        'oauth.kiro.importAllFailed': '导入失败！共 {count} 个 token 刷新失败',
        'oauth.kiro.importPartial': '部分成功：{success} 个成功，{failed} 个失败',
        'oauth.kiro.importError': '导入出错',
        'oauth.kiro.duplicateToken': '重复凭据 - 此 refreshToken 已存在',
        'oauth.kiro.duplicateCredentials': '该凭据已存在，请勿重复导入',
        'oauth.iflow.step1': '点击下方按钮在浏览器中打开 iFlow 授权页面',
        'oauth.iflow.step2': '使用您的 iFlow 账号登录并授权',
        'oauth.iflow.step3': '授权完成后，系统会自动获取 API Key',
        'oauth.iflow.step4': '凭据文件可在上传配置管理中查看和管理',

        // Config
        'config.title': '配置管理',
        'config.apiKey': 'API密钥',
        'config.apiKeyPlaceholder': '请输入API密钥',
        'config.host': '监听地址',
        'config.port': '端口',
        'config.modelProvider': '模型提供商',
        'config.modelProviderHelp': '勾选启动时初始化的模型提供商 (必须至少勾选一个)',
        'config.modelProviderRequired': '必须至少勾选一个模型提供商',
        'config.optional': '(选填)',
        'config.gemini.baseUrl': 'Gemini Base URL',
        'config.gemini.baseUrlPlaceholder': 'https://cloudcode-pa.googleapis.com',
        'config.gemini.projectId': '项目ID',
        'config.gemini.projectIdPlaceholder': 'Google Cloud项目ID',
        'config.gemini.oauthCreds': 'OAuth凭据',
        'config.gemini.credsType.file': '文件路径',
        'config.gemini.credsType.base64': 'Base64编码',
        'config.gemini.credsBase64': 'OAuth凭据 (Base64)',
        'config.gemini.credsBase64Placeholder': '请输入Base64编码的OAuth凭据',
        'config.gemini.credsFilePath': 'OAuth凭据文件路径',
        'config.gemini.credsFilePathPlaceholder': '例如: ~/.gemini/oauth_creds.json',
        'config.antigravity.dailyUrl': 'Daily Base URL',
        'config.antigravity.dailyUrlPlaceholder': 'https://daily-cloudcode-pa.sandbox.googleapis.com',
        'config.antigravity.autopushUrl': 'Autopush Base URL',
        'config.antigravity.autopushUrlPlaceholder': 'https://autopush-cloudcode-pa.sandbox.googleapis.com',
        'config.antigravity.credsFilePath': 'OAuth凭据文件路径',
        'config.antigravity.credsFilePathPlaceholder': '例如: ~/.antigravity/oauth_creds.json',
        'config.antigravity.note': 'Antigravity 使用 Google OAuth 认证，需要提供凭据文件路径',
        'config.openai.apiKey': 'OpenAI API Key',
        'config.openai.apiKeyPlaceholder': 'sk-...',
        'config.openai.baseUrl': 'OpenAI Base URL',
        'config.openai.baseUrlPlaceholder': '例如: https://api.openai.com/v1',
        'config.claude.apiKey': 'Claude API Key',
        'config.claude.apiKeyPlaceholder': 'sk-ant-...',
        'config.claude.baseUrl': 'Claude Base URL',
        'config.claude.baseUrlPlaceholder': '例如: https://api.anthropic.com',
        'config.kiro.baseUrl': 'Base URL',
        'config.kiro.baseUrlPlaceholder': 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
        'config.kiro.refreshUrl': 'Refresh URL',
        'config.kiro.refreshUrlPlaceholder': 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
        'config.kiro.refreshIdcUrl': 'Refresh IDC URL',
        'config.kiro.refreshIdcUrlPlaceholder': 'https://oidc.{{region}}.amazonaws.com/token',
        'config.kiro.credsFilePath': 'OAuth凭据文件路径',
        'config.kiro.credsFilePathPlaceholder': '例如: ~/.aws/sso/cache/kiro-auth-token.json',
        'config.kiro.note': '使用 AWS 登录方式时，请确保授权文件中包含 clientId 和 clientSecret 字段',
        'config.qwen.baseUrl': 'Qwen Base URL',
        'config.qwen.baseUrlPlaceholder': 'https://portal.qwen.ai/v1',
        'config.qwen.oauthBaseUrl': 'OAuth Base URL',
        'config.qwen.oauthBaseUrlPlaceholder': 'https://chat.qwen.ai',
        'config.qwen.credsFilePath': 'OAuth凭据文件路径',
        'config.qwen.credsFilePathPlaceholder': '例如: ~/.qwen/oauth_creds.json',
        'config.advanced.title': '高级配置',
        'config.advanced.systemPromptFile': '系统提示文件路径',
        'config.advanced.systemPromptFilePlaceholder': '例如: configs/input_system_prompt.txt',
        'config.advanced.systemPromptMode': '系统提示模式',
        'config.advanced.systemPromptMode.append': '追加 (append)',
        'config.advanced.systemPromptMode.overwrite': '覆盖 (overwrite)',
        'config.advanced.promptLogBaseName': '提示日志基础名称',
        'config.advanced.promptLogBaseNamePlaceholder': '例如: prompt_log',
        'config.advanced.promptLogMode': '提示日志模式',
        'config.advanced.promptLogMode.none': '无 (none)',
        'config.advanced.promptLogMode.console': '控制台 (console)',
        'config.advanced.promptLogMode.file': '文件 (file)',
        'config.advanced.maxRetries': '最大重试次数',
        'config.advanced.baseDelay': '重试基础延迟(毫秒)',
        'config.advanced.cronInterval': 'OAuth令牌刷新间隔(分钟)',
        'config.advanced.cronEnabled': '启用OAuth令牌自动刷新(需重启服务)',
        'config.advanced.poolFilePath': '提供商池配置文件路径(不能为空)',
        'config.advanced.poolFilePathPlaceholder': '默认: configs/provider_pools.json',
        'config.advanced.poolNote': '使用默认路径配置需添加一个空节点',
        'config.advanced.maxErrorCount': '提供商最大错误次数',
        'config.advanced.maxErrorCountPlaceholder': '默认: 3',
        'config.advanced.maxErrorCountNote': '提供商连续错误达到此次数后将被标记为不健康，默认为 3 次',
        'config.advanced.fallbackChain': '跨类型 Fallback 链配置',
        'config.advanced.fallbackChainPlaceholder': '例如:\n{\n  "gemini-cli-oauth": ["gemini-antigravity"],\n  "gemini-antigravity": ["gemini-cli-oauth"],\n  "claude-kiro-oauth": ["claude-custom"]\n}',
        'config.advanced.fallbackChainNote': '当某一 Provider Type 所有账号都不健康时，自动切换到配置的 Fallback 类型。JSON 格式，键为主类型，值为 Fallback 类型数组（按优先级排序）',
        'config.advanced.fallbackChainInvalid': 'Fallback 链配置格式无效，请输入有效的 JSON',
        'config.advanced.modelFallbackMapping': '跨协议模型 Fallback 映射',
        'config.advanced.modelFallbackMappingPlaceholder': '例如:\n{\n  "gemini-claude-opus-4-5-thinking": {\n    "targetProviderType": "claude-kiro-oauth",\n    "targetModel": "claude-opus-4-5"\n  }\n}',
        'config.advanced.modelFallbackMappingNote': '当主 Provider 不可用时，根据模型名映射到其他协议的 Provider 和模型。优先级低于上方的 Fallback 链配置。JSON 格式。',
        'config.advanced.modelFallbackMappingInvalid': 'Model Fallback 映射配置格式无效，请输入有效的 JSON',
        'config.advanced.systemPrompt': '系统提示',
        'config.advanced.systemPromptPlaceholder': '输入系统提示...',
        'config.advanced.adminPassword': '后台登录密码',
        'config.advanced.adminPasswordPlaceholder': '设置后台登录密码（留空则不修改）',
        'config.advanced.adminPasswordNote': '用于保护管理控制台的访问，修改后需要重新登录',
        'config.proxy.title': '代理设置',
        'config.proxy.url': '代理地址',
        'config.proxy.urlPlaceholder': '例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080',
        'config.proxy.urlNote': '支持 HTTP、HTTPS 和 SOCKS5 代理，留空则不使用代理',
        'config.proxy.enabledProviders': '启用代理的提供商',
        'config.proxy.enabledProvidersNote': '选择需要通过代理访问的提供商，未选中的提供商将直接连接',
        'config.save': '保存配置',
        'config.reset': '重置',
        'config.placeholder.nodeName': '例如: 我的节点1',
        'config.placeholder.model': '例如: gpt-3.5-turbo',
        
        // Upload Config
        'upload.title': '配置管理',
        'upload.search': '搜索配置',
        'upload.searchPlaceholder': '输入文件名',
        'upload.statusFilter': '关联状态',
        'upload.statusFilter.all': '全部状态',
        'upload.statusFilter.used': '已关联',
        'upload.statusFilter.unused': '未关联',
        'upload.refresh': '刷新',
        'upload.downloadAll': '打包下载',
        'upload.listTitle': '配置文件列表',
        'upload.count': '共 {count} 个配置文件',
        'upload.usedCount': '已关联: {count}',
        'upload.unusedCount': '未关联: {count}',
        'upload.batchLink': '自动关联oauth',
        'upload.noConfigs': '未找到匹配的配置文件',
        'upload.detail.path': '文件路径',
        'upload.detail.size': '文件大小',
        'upload.detail.modified': '最后修改',
        'upload.detail.status': '关联状态',
        'upload.action.view': '查看',
        'upload.action.delete': '删除',
        'upload.usage.title': '关联详情 ({type})',
        'upload.usage.mainConfig': '主要配置',
        'upload.usage.providerPool': '提供商池',
        'upload.usage.multiple': '多种用途',
        'upload.delete.confirmTitle': '删除配置文件',
        'upload.delete.confirmTitleUsed': '删除已关联配置',
        'upload.delete.warningUsedTitle': '⚠️ 此配置已被系统使用',
        'upload.delete.warningUsedDesc': '删除已关联的配置文件可能会影响系统正常运行。请确保您了解删除的后果。',
        'upload.delete.warningUnusedTitle': '🗑️ 确认删除配置文件',
        'upload.delete.warningUnusedDesc': '此操作将永久删除配置文件，且无法撤销。',
        'upload.delete.fileName': '文件名:',
        'upload.delete.usageAlertTitle': '关联详情',
        'upload.delete.usageAlertDesc': '此配置文件正在被系统使用，删除后可能会导致:',
        'upload.delete.usageAlertItem1': '相关的AI服务无法正常工作',
        'upload.delete.usageAlertItem2': '配置管理中的设置失效',
        'upload.delete.usageAlertItem3': '提供商池配置丢失',
        'upload.delete.usageAlertAdvice': '<strong>建议：</strong>请先在配置管理中解除文件引用后再删除。',
        'upload.delete.forceDelete': '强制删除',
        'upload.delete.confirmDelete': '确认删除',
        'upload.batchLink.confirm': '确定要批量关联 {count} 个配置吗？\n\n{summary}',
        'upload.refresh.success': '刷新成功',
        'upload.action.view.failed': '查看失败',
        'upload.action.delete.failed': '删除失败',
        'upload.config.notExist': '配置文件不存在',
        'upload.link.identifying': '正在识别提供商类型...',
        'upload.link.failed.identify': '无法识别配置文件对应的提供商类型',
        'upload.link.processing': '正在关联配置到 {name}...',
        'upload.link.success': '配置关联成功',
        'upload.link.failed': '关联失败',
        'upload.batchLink.none': '没有需要关联的配置文件',
        'upload.batchLink.processing': '正在批量关联 {count} 个配置...',
        'upload.batchLink.success': '成功关联 {count} 个配置',
        'upload.batchLink.partial': '关联完成: 成功 {success} 个, 失败 {fail} 个',
        
        // Providers
        'providers.title': '提供商池管理',
        'providers.note': '使用默认路径配置需添加一个空节点',
        'providers.activeConnections': '活动连接',
        'providers.activeProviders': '活跃提供商',
        'providers.healthyProviders': '健康提供商',
        'providers.status.healthy': '{healthy}/{total} 健康',
        'providers.status.empty': '0/0 节点',
        'providers.stat.totalAccounts': '总账户',
        'providers.stat.healthyAccounts': '健康账户',
        'providers.stat.usageCount': '使用次数',
        'providers.stat.errorCount': '错误次数',
        'providers.auth.generate': '生成授权',

        // Modal Provider Manager
        'modal.provider.manage': '管理 {type} 提供商配置',
        'modal.provider.totalAccounts': '总账户数:',
        'modal.provider.healthyAccounts': '健康账户:',
        'modal.provider.add': '添加新提供商',
        'modal.provider.resetHealth': '重置为健康',
        'modal.provider.healthCheck': '健康检测',
        'modal.provider.resetHealthConfirm': '确定要将 {type} 的所有节点重置为健康状态吗？\n\n这将清除所有节点的错误计数和错误时间。',
        'modal.provider.healthCheckConfirm': '确定要对 {type} 的所有节点执行健康检测吗？\n\n这将向每个节点发送测试请求来验证其可用性。',
        'modal.provider.deleteConfirm': '确定要删除这个提供商配置吗？此操作不可恢复。',
        'modal.provider.disableConfirm': '确定要禁用这个提供商配置吗？禁用后该提供商将不会被选中使用。',
        'modal.provider.enableConfirm': '确定要启用这个提供商配置吗？',
        'modal.provider.edit': '编辑',
        'modal.provider.delete': '删除',
        'modal.provider.save': '保存',
        'modal.provider.cancel': '取消',
        'modal.provider.status.healthy': '正常',
        'modal.provider.status.unhealthy': '异常',
        'modal.provider.status.disabled': '已禁用',
        'modal.provider.status.enabled': '已启用',
        'modal.provider.lastError': '最后错误:',
        'modal.provider.lastUsed': '最后使用:',
        'modal.provider.lastCheck': '最后检测:',
        'modal.provider.checkModel': '检测模型:',
        'modal.provider.usageCount': '使用次数:',
        'modal.provider.errorCount': '失败次数:',
        'modal.provider.neverUsed': '从未使用',
        'modal.provider.neverChecked': '从未检测',
        'modal.provider.noModels': '该提供商类型暂无可用模型列表',
        'modal.provider.loadingModels': '加载模型列表...',
        'modal.provider.unsupportedModels': '不支持的模型',
        'modal.provider.unsupportedModelsHelp': '选择此提供商不支持的模型，系统会自动排除这些模型',
        'modal.provider.addTitle': '添加新提供商配置',
        'modal.provider.customName': '自定义名称',
        'modal.provider.checkModelName': '检查模型名称',
        'modal.provider.healthCheckLabel': '健康检查',
        'modal.provider.enabled': '启用',
        'modal.provider.disabled': '禁用',
        'modal.provider.noProviderType': '不支持的提供商类型',

        'modal.provider.load.failed': '加载提供商详情失败',
        'modal.provider.auth.initializing': '正在初始化凭据生成...',
        'modal.provider.auth.success': '凭据已生成并自动填充路径',
        'modal.provider.auth.window': '请在打开的窗口中完成授权',
        'modal.provider.auth.failed': '初始化凭据生成失败',
        'modal.provider.save.success': '保存成功',
        'modal.provider.save.failed': '保存失败',
        'modal.provider.delete.success': '删除成功',
        'modal.provider.delete.failed': '删除失败',
        'modal.provider.add.success': '添加成功',
        'modal.provider.add.failed': '添加失败',
        'modal.provider.resetHealth.success': '成功重置 {count} 个节点的健康状态',
        'modal.provider.resetHealth.failed': '重置健康状态失败',
        'modal.provider.kiroAuthHint': '使用 AWS Builder ID 登录方式时，需要 <code>clientId</code> 和 <code>clientSecret</code> 字段，可在同文件夹下的另一个 JSON 文件中获取',
        
        // Pagination
        'pagination.showing': '显示 {start}-{end} / 共 {total} 条',
        'pagination.jumpTo': '跳转到',
        'pagination.page': '页',
        
        // Usage
        'usage.title': '用量查询',
        'usage.refresh': '刷新用量',
        'usage.lastUpdate': '上次更新: {time}',
        'usage.lastUpdateCache': '缓存时间: {time}',
        'usage.loading': '正在加载用量数据...',
        'usage.empty': '点击"刷新用量"按钮获取授权文件用量信息',
        'usage.noData': '暂无用量数据',
        'usage.noInstances': '暂无已初始化的服务实例',
        'usage.group.instances': '{count} 个实例',
        'usage.group.success': '{count}/{total} 成功',
        'usage.card.status.disabled': '已禁用',
        'usage.card.status.healthy': '健康',
        'usage.card.status.unhealthy': '异常',
        'usage.card.totalUsage': '总用量',
        'usage.card.freeTrial': '免费试用',
        'usage.card.bonus': '奖励',
        'usage.card.expires': '到期: {time}',
        'usage.group.expandAll': '展开所有卡片',
        'usage.group.collapseAll': '折叠所有卡片',
        
        // Logs
        'logs.title': '实时日志',
        'logs.clear': '清空日志',
        'logs.autoScroll': '自动滚动',
        'logs.autoScroll.on': '自动滚动: 开',
        'logs.autoScroll.off': '自动滚动: 关',
        
        // Plugins
        'plugins.title': '插件管理',
        'plugins.description': '插件系统允许您扩展系统功能，启用或禁用插件需要重启服务才能生效',
        'plugins.stats.total': '总插件数',
        'plugins.stats.enabled': '已启用',
        'plugins.stats.disabled': '已禁用',
        'plugins.refresh': '刷新插件列表',
        'plugins.loading': '正在加载插件列表...',
        'plugins.empty': '暂无已安装的插件',
        'plugins.noDescription': '暂无描述',
        'plugins.status.enabled': '已启用',
        'plugins.status.disabled': '已禁用',
        'plugins.badge.middleware.title': '包含中间件',
        'plugins.badge.routes.title': '包含路由',
        'plugins.badge.hooks.title': '包含钩子',
        'plugins.toggle.success': '插件 {name} 已{status}',
        'plugins.toggle.failed': '切换插件状态失败',
        'plugins.load.failed': '加载插件列表失败',
        'plugins.restart.required': '更改已保存，请重启服务以生效',

        // Common
        'common.confirm': '确定',
        'common.cancel': '取消',
        'common.success': '成功',
        'common.error': '错误',
        'common.warning': '警告',
        'common.info': '信息',
        'common.loading': '加载中...',
        'common.upload': '上传',
        'common.generate': '生成',
        'common.found': '已找到',
        'common.missing': '缺失',
        'common.search': '搜索',
        'common.welcome': '欢迎使用AIClient2API管理控制台！',
        'common.fileType': '不支持的文件类型，请选择 JSON、TXT、KEY、PEM、P12 或 PFX 文件',
        'common.fileSize': '文件大小不能超过 5MB',
        'common.uploadSuccess': '文件上传成功',
        'common.uploadFailed': '文件上传失败',
        'common.passwordUpdated': '后台密码已更新，下次登录生效',
        'common.configSaved': '配置已保存',
        'common.providerPoolRefreshed': '提供商池数据已刷新',
        'common.togglePassword': '显示/隐藏密码',
        'common.copy.success': '内容已复制到剪贴板',
        'common.copy.failed': '复制失败，请手动复制',
        'common.refresh.success': '刷新成功',
        'common.refresh.failed': '刷新失败',
        
        // Login
        'login.title': '登录 - AIClient2API',
        'login.heading': '请登录以继续',
        'login.password': '密码',
        'login.passwordPlaceholder': '请输入密码',
        'login.error.empty': '请输入密码',
        'login.error.incorrect': '密码错误，请重试',
        'login.error.failed': '登录失败，请检查网络连接',
        'login.button': '登录',
        'login.loggingIn': '登录中...',
    },
    'en-US': {
        // Header
        'header.title': 'AIClient2API Management Console',
        'header.description': 'AIClient2API Management Console - Unified management of AI service providers',
        'header.github': 'GitHub Repository',
        'header.themeToggle': 'Toggle Theme',
        'header.status.connecting': 'Connecting...',
        'header.status.connected': 'Connected',
        'header.status.disconnected': 'Disconnected',
        'header.logout': 'Logout',
        'header.reload': 'Reload',
        'header.reload.confirm': 'Are you sure you want to reload the configuration? This will reload all configuration files.',
        'header.reload.requesting': 'Reloading configuration...',
        'header.reload.success': 'Configuration reloaded successfully',
        'header.reload.failed': 'Failed to reload configuration',
        'header.refresh': 'Reload',
        'header.restart': 'Restart',
        'header.restart.confirm': 'Are you sure you want to restart the service? The service will be briefly interrupted.',
        'header.restart.requesting': 'Requesting service restart...',
        'header.restart.success': 'Restart request sent, service will restart shortly',
        'header.restart.reconnecting': 'Reconnecting...',
        'header.restart.failed': 'Failed to restart service',
        
        // Navigation
        'nav.main': 'Main Navigation',
        'nav.dashboard': 'Dashboard',
        'nav.config': 'Configuration',
        'nav.providers': 'Provider Pools',
        'nav.upload': 'Config Management',
        'nav.usage': 'Usage Query',
        'nav.logs': 'Real-time Logs',
        'nav.plugins': 'Plugin Management',
        
        // Dashboard
        'dashboard.title': 'System Overview',
        'dashboard.uptime': 'Uptime',
        'dashboard.systemInfo': 'System Information',
        'dashboard.version': 'Version',
        'dashboard.update.check': 'Check Update',
        'dashboard.update.checkTitle': 'Check for new version',
        'dashboard.update.perform': 'Update Now',
        'dashboard.update.performTitle': 'Update to latest version',
        'dashboard.update.checking': 'Checking...',
        'dashboard.update.upToDate': 'Up to date',
        'dashboard.update.hasUpdate': 'New version available: {version}',
        'dashboard.update.updating': 'Updating...',
        'dashboard.update.success': 'Update successful',
        'dashboard.update.needsRestart': 'Code updated, please click the "Restart" button in the top right corner for changes to take effect',
        'dashboard.update.restartTitle': 'Update Complete',
        'dashboard.update.restartMsg': 'Code has been updated to version {version}. Please click the "Restart" button in the top right corner for the new code to take effect.',
        'dashboard.update.failed': 'Update failed: {error}',
        'dashboard.update.confirmTitle': 'Confirm Update',
        'dashboard.update.confirmMsg': 'Are you sure you want to update to version {version}? Service might be briefly unavailable during update.',
        'dashboard.nodeVersion': 'Node.js Version',
        'dashboard.serverTime': 'Server Time',
        'dashboard.memoryUsage': 'Memory Usage',
        'dashboard.cpuUsage': 'CPU Usage',
        'dashboard.serviceMode': 'Service Mode',
        'dashboard.serviceMode.worker': 'Worker Mode',
        'dashboard.serviceMode.standalone': 'Standalone Mode',
        'dashboard.serviceMode.canRestart': 'Auto-restart supported',
        'dashboard.processPid': 'Process PID',
        'dashboard.platform': 'Platform',
        'dashboard.routing.title': 'Path Routing Examples',
        'dashboard.routing.description': 'Access different AI model providers through different path routes, supporting flexible model switching',
        'dashboard.routing.oauth': 'Limit Breakthrough',
        'dashboard.routing.official': 'Official/Third-party API',
        'dashboard.routing.experimental': 'Limit Breakthrough/Experimental',
        'dashboard.routing.free': 'Limit Breakthrough/Free',
        'dashboard.routing.endpoint': 'Endpoint Path:',
        'dashboard.routing.example': 'Usage Example',
        'dashboard.routing.exampleOpenAI': 'Usage Example (OpenAI):',
        'dashboard.routing.exampleClaude': 'Usage Example (Claude):',
        'dashboard.routing.openai': 'OpenAI Protocol',
        'dashboard.routing.claude': 'Claude Protocol',
        'dashboard.routing.tips': 'Usage Tips',
        'dashboard.routing.tip1': 'Instant Switch: Switch between different AI model providers by modifying the URL path',
        'dashboard.routing.tip2': 'Client Configuration: Set API endpoint to corresponding path in clients like Cherry-Studio, NextChat, Cline',
        'dashboard.routing.tip3': 'Cross-protocol Calls: Support calling Claude models with OpenAI protocol, or OpenAI models with Claude protocol',
        'dashboard.routing.nodeName.gemini': 'Gemini CLI OAuth',
        'dashboard.routing.nodeName.antigravity': 'Gemini Antigravity',
        'dashboard.routing.nodeName.claude': 'Claude Custom',
        'dashboard.routing.nodeName.kiro': 'Claude Kiro OAuth',
        'dashboard.routing.nodeName.openai': 'OpenAI Custom',
        'dashboard.routing.nodeName.qwen': 'Qwen OAuth',
        'dashboard.routing.nodeName.iflow': 'iFlow OAuth',
        'dashboard.contact.title': 'Contact & Support',
        'dashboard.contact.wechat': 'Scan to Join Group',
        'dashboard.contact.wechatDesc': 'Add WeChat for more technical support and communication',
        'dashboard.contact.x': 'Follow on X.com',
        'dashboard.contact.xDesc': 'Follow us on X for latest updates',
        'dashboard.contact.sponsor': 'Scan to Support',
        'dashboard.contact.sponsorDesc': 'Your support is the driving force for the project\'s continuous development',
        'dashboard.contact.coffee': 'Buy me a coffee',
        'dashboard.contact.coffeeDesc': 'If you like this project, buy me a coffee!',
        
        // OAuth
        'oauth.modal.title': 'OAuth Authorization',
        'oauth.modal.provider': 'Provider:',
        'oauth.modal.requiredPort': 'Required Port:',
        'oauth.modal.portNote': 'Please ensure this port is accessible externally for receiving authorization callbacks',
        'oauth.modal.steps': 'Authorization Steps:',
        'oauth.modal.step1': 'Click the button below to open the authorization page in your browser',
        'oauth.modal.step2.qwen': 'After authorization, the system will automatically fetch the credentials file',
        'oauth.modal.step2.google': 'Log in with your Google account and authorize',
        'oauth.modal.step3': 'Credentials files can be viewed and managed in Upload Config',
        'oauth.modal.step4.qwen': 'Authorization valid for: {min} minutes',
        'oauth.modal.step4.google': 'After authorization, the credentials file will be saved automatically',
        'oauth.modal.urlLabel': 'Auth URL:',
        'oauth.modal.copyTitle': 'Copy Link',
        'oauth.modal.openInBrowser': 'Open in Browser',
        'oauth.manual.title': 'Auto-listener blocked?',
        'oauth.manual.desc': 'If the auth window shows "Cannot access" after redirect, please paste the <strong>Full URL</strong> from that window\'s address bar below:',
        'oauth.manual.placeholder': 'Paste callback URL (contains code=...)',
        'oauth.manual.submit': 'Submit',
        'oauth.success.msg': 'Authorization link copied to clipboard',
        'oauth.window.blocked': 'Auth window was blocked by the browser, please allow pop-ups',
        'oauth.window.opened': 'Auth window opened, please complete the process there',
        'oauth.processing': 'Completing authorization...',
        'oauth.invalid.url': 'This URL does not seem to contain a valid auth code',
        'oauth.error.format': 'Invalid URL format',
        'oauth.kiro.selectMethod': 'Select Authentication Method',
        'oauth.kiro.google': 'Google Account Login',
        'oauth.kiro.googleDesc': 'Login with Google account',
        'oauth.kiro.github': 'GitHub Account Login',
        'oauth.kiro.githubDesc': 'Login with GitHub account',
        'oauth.kiro.awsBuilder': 'AWS Builder ID',
        'oauth.kiro.awsBuilderDesc': 'Device code authorization via AWS Builder ID',
        'oauth.kiro.authMethodLabel': 'Auth Method:',
        'oauth.kiro.step1': 'Click the button below to open the authorization link in your browser',
        'oauth.kiro.step2': 'Log in with your {method} account',
        'oauth.kiro.step3': 'The page will close automatically after authorization',
        'oauth.kiro.step4': 'Refresh this page to view the credentials file',
        'oauth.kiro.batchImport': 'Batch Import refreshToken',
        'oauth.kiro.batchImportDesc': 'Batch import existing refresh tokens to generate credential files. This mode does not support AWS accounts.',
        'oauth.kiro.batchImportInstructions': 'Enter refreshTokens, one per line. The system will automatically refresh and generate credential files.',
        'oauth.kiro.awsImport': 'Import AWS Account',
        'oauth.kiro.awsImportDesc': 'Import credential files from AWS SSO cache directory. For AWS Builder ID mode.',
        'oauth.kiro.awsImportInstructions': 'Upload JSON files from AWS SSO cache directory. Must contain clientId, clientSecret, accessToken, and refreshToken.',
        'oauth.kiro.awsModeFile': 'File Upload',
        'oauth.kiro.awsModeJson': 'Paste JSON',
        'oauth.kiro.awsUploadFiles': 'Upload Credential Files',
        'oauth.kiro.awsDragDrop': 'Drag and drop files here',
        'oauth.kiro.awsClickUpload': 'or click to select files',
        'oauth.kiro.awsFileHint': 'If one file doesn\'t contain all fields, you can upload multiple files to complete them',
        'oauth.kiro.awsSelectedFiles': 'Selected Files',
        'oauth.kiro.awsClearFiles': 'Clear All',
        'oauth.kiro.awsFileReplaced': 'Replaced file: {filename}',
        'oauth.kiro.awsJsonInput': 'Paste JSON Credentials',
        'oauth.kiro.awsJsonPlaceholderSimple': 'Paste JSON containing clientId, clientSecret, accessToken, refreshToken here...',
        'oauth.kiro.awsJsonExample': 'View JSON format example',
        'oauth.kiro.awsJsonHint': 'You can paste merged JSON directly, or copy content from AWS SSO cache files',
        'oauth.kiro.awsJsonParseError': 'Invalid JSON format',
        'oauth.kiro.awsParseError': 'Failed to parse file {filename}',
        'oauth.kiro.awsValidationSuccess': 'Validation passed! All required fields found',
        'oauth.kiro.awsValidationFailed': 'Validation failed! Required fields missing',
        'oauth.kiro.awsMissingFields': '{count} field(s) missing',
        'oauth.kiro.awsUploadMore': 'Please upload files containing the missing fields, or switch to JSON mode to complete manually',
        'oauth.kiro.awsPreviewJson': 'Merged Credentials Preview',
        'oauth.kiro.awsConfirmImport': 'Confirm Import',
        'oauth.kiro.awsNoCredentials': 'No credentials to import',
        'oauth.kiro.awsImporting': 'Importing...',
        'oauth.kiro.awsImportSuccess': 'AWS credentials imported successfully!',
        'oauth.kiro.awsImportFailed': 'AWS credentials import failed',
        'oauth.kiro.refreshTokensLabel': 'RefreshToken List',
        'oauth.kiro.refreshTokensPlaceholder': 'Enter one refreshToken per line\nExample:\naorAxxxxxxxx\naorAyyyyyyyy\naorAzzzzzzzz',
        'oauth.kiro.tokenCount': 'Tokens to import:',
        'oauth.kiro.importing': 'Importing, please wait...',
        'oauth.kiro.importingProgress': 'Importing {current}/{total}...',
        'oauth.kiro.startImport': 'Start Import',
        'oauth.kiro.noTokens': 'Please enter at least one refreshToken',
        'oauth.kiro.importSuccess': 'Import successful! {count} credentials generated',
        'oauth.kiro.importAllFailed': 'Import failed! {count} tokens failed to refresh',
        'oauth.kiro.importPartial': 'Partial success: {success} succeeded, {failed} failed',
        'oauth.kiro.importError': 'Import error',
        'oauth.kiro.duplicateToken': 'Duplicate - this refreshToken already exists',
        'oauth.kiro.duplicateCredentials': 'This credential already exists, please do not import duplicates',
        'oauth.iflow.step1': 'Click the button below to open the iFlow authorization page',
        'oauth.iflow.step2': 'Log in with your iFlow account and authorize',
        'oauth.iflow.step3': 'After authorization, the system will automatically fetch the API Key',
        'oauth.iflow.step4': 'Credentials files can be viewed and managed in Upload Config',

        // Config
        'config.title': 'Configuration Management',
        'config.apiKey': 'API Key',
        'config.apiKeyPlaceholder': 'Please enter API key',
        'config.host': 'Listen Address',
        'config.port': 'Port',
        'config.modelProvider': 'Model Provider',
        'config.modelProviderHelp': 'Check model providers to initialize on startup (must select at least one)',
        'config.modelProviderRequired': 'At least one model provider must be selected',
        'config.optional': '(Optional)',
        'config.gemini.baseUrl': 'Gemini Base URL',
        'config.gemini.baseUrlPlaceholder': 'https://cloudcode-pa.googleapis.com',
        'config.gemini.projectId': 'Project ID',
        'config.gemini.projectIdPlaceholder': 'Google Cloud Project ID',
        'config.gemini.oauthCreds': 'OAuth Credentials',
        'config.gemini.credsType.file': 'File Path',
        'config.gemini.credsType.base64': 'Base64 Encoded',
        'config.gemini.credsBase64': 'OAuth Credentials (Base64)',
        'config.gemini.credsBase64Placeholder': 'Please enter Base64 encoded OAuth credentials',
        'config.gemini.credsFilePath': 'OAuth Credentials File Path',
        'config.gemini.credsFilePathPlaceholder': 'e.g.: ~/.gemini/oauth_creds.json',
        'config.antigravity.dailyUrl': 'Daily Base URL',
        'config.antigravity.dailyUrlPlaceholder': 'https://daily-cloudcode-pa.sandbox.googleapis.com',
        'config.antigravity.autopushUrl': 'Autopush Base URL',
        'config.antigravity.autopushUrlPlaceholder': 'https://autopush-cloudcode-pa.sandbox.googleapis.com',
        'config.antigravity.credsFilePath': 'OAuth Credentials File Path',
        'config.antigravity.credsFilePathPlaceholder': 'e.g.: ~/.antigravity/oauth_creds.json',
        'config.antigravity.note': 'Antigravity uses Google OAuth authentication, requires credentials file path',
        'config.openai.apiKey': 'OpenAI API Key',
        'config.openai.apiKeyPlaceholder': 'sk-...',
        'config.openai.baseUrl': 'OpenAI Base URL',
        'config.openai.baseUrlPlaceholder': 'e.g.: https://api.openai.com/v1',
        'config.claude.apiKey': 'Claude API Key',
        'config.claude.apiKeyPlaceholder': 'sk-ant-...',
        'config.claude.baseUrl': 'Claude Base URL',
        'config.claude.baseUrlPlaceholder': 'e.g.: https://api.anthropic.com',
        'config.kiro.baseUrl': 'Base URL',
        'config.kiro.baseUrlPlaceholder': 'https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse',
        'config.kiro.refreshUrl': 'Refresh URL',
        'config.kiro.refreshUrlPlaceholder': 'https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken',
        'config.kiro.refreshIdcUrl': 'Refresh IDC URL',
        'config.kiro.refreshIdcUrlPlaceholder': 'https://oidc.{{region}}.amazonaws.com/token',
        'config.kiro.credsFilePath': 'OAuth Credentials File Path',
        'config.kiro.credsFilePathPlaceholder': 'e.g.: ~/.aws/sso/cache/kiro-auth-token.json',
        'config.kiro.note': 'When using AWS login method, ensure the authorization file contains clientId and clientSecret fields',
        'config.qwen.baseUrl': 'Qwen Base URL',
        'config.qwen.baseUrlPlaceholder': 'https://portal.qwen.ai/v1',
        'config.qwen.oauthBaseUrl': 'OAuth Base URL',
        'config.qwen.oauthBaseUrlPlaceholder': 'https://chat.qwen.ai',
        'config.qwen.credsFilePath': 'OAuth Credentials File Path',
        'config.qwen.credsFilePathPlaceholder': 'e.g.: ~/.qwen/oauth_creds.json',
        'config.advanced.title': 'Advanced Configuration',
        'config.advanced.systemPromptFile': 'System Prompt File Path',
        'config.advanced.systemPromptFilePlaceholder': 'e.g.: configs/input_system_prompt.txt',
        'config.advanced.systemPromptMode': 'System Prompt Mode',
        'config.advanced.systemPromptMode.append': 'Append',
        'config.advanced.systemPromptMode.overwrite': 'Overwrite',
        'config.advanced.promptLogBaseName': 'Prompt Log Base Name',
        'config.advanced.promptLogBaseNamePlaceholder': 'e.g.: prompt_log',
        'config.advanced.promptLogMode': 'Prompt Log Mode',
        'config.advanced.promptLogMode.none': 'None',
        'config.advanced.promptLogMode.console': 'Console',
        'config.advanced.promptLogMode.file': 'File',
        'config.advanced.maxRetries': 'Max Retries',
        'config.advanced.baseDelay': 'Base Retry Delay (ms)',
        'config.advanced.cronInterval': 'OAuth Token Refresh Interval (minutes)',
        'config.advanced.cronEnabled': 'Enable OAuth Token Auto Refresh (requires restart)',
        'config.advanced.poolFilePath': 'Provider Pool Config File Path (required)',
        'config.advanced.poolFilePathPlaceholder': 'Default: configs/provider_pools.json',
        'config.advanced.poolNote': 'To use default path configuration, add an empty node',
        'config.advanced.maxErrorCount': 'Provider Max Error Count',
        'config.advanced.maxErrorCountPlaceholder': 'Default: 3',
        'config.advanced.maxErrorCountNote': 'Provider will be marked as unhealthy after consecutive errors reach this count, default is 3',
        'config.advanced.fallbackChain': 'Cross-Type Fallback Chain Config',
        'config.advanced.fallbackChainPlaceholder': 'Example:\n{\n  "gemini-cli-oauth": ["gemini-antigravity"],\n  "gemini-antigravity": ["gemini-cli-oauth"],\n  "claude-kiro-oauth": ["claude-custom"]\n}',
        'config.advanced.fallbackChainNote': 'When all accounts of a Provider Type are unhealthy, automatically switch to configured Fallback types. JSON format, key is primary type, value is Fallback type array (sorted by priority)',
        'config.advanced.fallbackChainInvalid': 'Invalid Fallback chain config format, please enter valid JSON',
        'config.advanced.modelFallbackMapping': 'Cross-Protocol Model Fallback Mapping',
        'config.advanced.modelFallbackMappingPlaceholder': 'Example:\n{\n  "gemini-claude-opus-4-5-thinking": {\n    "targetProviderType": "claude-kiro-oauth",\n    "targetModel": "claude-opus-4-5"\n  }\n}',
        'config.advanced.modelFallbackMappingNote': 'When the primary Provider is unavailable, map to other protocol Providers and models by model name. Priority is lower than the Fallback Chain Config above. JSON format.',
        'config.advanced.modelFallbackMappingInvalid': 'Invalid Model Fallback mapping config format, please enter valid JSON',
        'config.advanced.systemPrompt': 'System Prompt',
        'config.advanced.systemPromptPlaceholder': 'Enter system prompt...',
        'config.advanced.adminPassword': 'Admin Password',
        'config.advanced.adminPasswordPlaceholder': 'Set admin password (leave empty to keep unchanged)',
        'config.advanced.adminPasswordNote': 'Used to protect management console access, requires re-login after modification',
        'config.proxy.title': 'Proxy Settings',
        'config.proxy.url': 'Proxy URL',
        'config.proxy.urlPlaceholder': 'e.g.: http://127.0.0.1:7890 or socks5://127.0.0.1:1080',
        'config.proxy.urlNote': 'Supports HTTP, HTTPS and SOCKS5 proxies. Leave empty to disable proxy',
        'config.proxy.enabledProviders': 'Providers Using Proxy',
        'config.proxy.enabledProvidersNote': 'Select providers that should use the proxy. Unselected providers will connect directly',
        'config.save': 'Save Configuration',
        'config.reset': 'Reset',
        'config.placeholder.nodeName': 'e.g.: My Node 1',
        'config.placeholder.model': 'e.g.: gpt-3.5-turbo',
        
        // Upload Config
        'upload.title': 'Config Management',
        'upload.search': 'Search Config',
        'upload.searchPlaceholder': 'Enter filename',
        'upload.statusFilter': 'Association Status',
        'upload.statusFilter.all': 'All Status',
        'upload.statusFilter.used': 'Associated',
        'upload.statusFilter.unused': 'Not Associated',
        'upload.refresh': 'Refresh',
        'upload.downloadAll': 'Download All (ZIP)',
        'upload.listTitle': 'Configuration File List',
        'upload.count': 'Total {count} config files',
        'upload.usedCount': 'Associated: {count}',
        'upload.unusedCount': 'Not Associated: {count}',
        'upload.batchLink': 'Auto Link OAuth',
        'upload.noConfigs': 'No matching configuration files found',
        'upload.detail.path': 'File Path',
        'upload.detail.size': 'File Size',
        'upload.detail.modified': 'Last Modified',
        'upload.detail.status': 'Status',
        'upload.action.view': 'View',
        'upload.action.delete': 'Delete',
        'upload.usage.title': 'Association Details ({type})',
        'upload.usage.mainConfig': 'Main Config',
        'upload.usage.providerPool': 'Provider Pool',
        'upload.usage.multiple': 'Multiple Purposes',
        'upload.delete.confirmTitle': 'Delete Config File',
        'upload.delete.confirmTitleUsed': 'Delete Associated Config',
        'upload.delete.warningUsedTitle': '⚠️ This config is currently in use',
        'upload.delete.warningUsedDesc': 'Deleting an associated config file may affect system stability. Please ensure you understand the consequences.',
        'upload.delete.warningUnusedTitle': '🗑️ Confirm deletion',
        'upload.delete.warningUnusedDesc': 'This operation will permanently delete the config file and cannot be undone.',
        'upload.delete.fileName': 'File Name:',
        'upload.delete.usageAlertTitle': 'Association Details',
        'upload.delete.usageAlertDesc': 'This file is being used by the system. Deletion may cause:',
        'upload.delete.usageAlertItem1': 'Related AI services to stop working',
        'upload.delete.usageAlertItem2': 'Settings in Config Management to become invalid',
        'upload.delete.usageAlertItem3': 'Provider pool configurations to be lost',
        'upload.delete.usageAlertAdvice': '<strong>Advice:</strong> Please remove file references in Config Management before deleting.',
        'upload.delete.forceDelete': 'Force Delete',
        'upload.delete.confirmDelete': 'Confirm Delete',
        'upload.batchLink.confirm': 'Are you sure you want to link {count} config files?\n\n{summary}',
        'upload.refresh.success': 'Refresh successful',
        'upload.action.view.failed': 'View failed',
        'upload.action.delete.failed': 'Delete failed',
        'upload.config.notExist': 'Configuration file does not exist',
        'upload.link.identifying': 'Identifying provider type...',
        'upload.link.failed.identify': 'Unable to identify provider type for the config file',
        'upload.link.processing': 'Linking configuration to {name}...',
        'upload.link.success': 'Configuration linked successfully',
        'upload.link.failed': 'Link failed',
        'upload.batchLink.none': 'No configuration files to link',
        'upload.batchLink.processing': 'Batch linking {count} configurations...',
        'upload.batchLink.success': 'Successfully linked {count} configurations',
        'upload.batchLink.partial': 'Linking completed: {success} succeeded, {fail} failed',
        
        // Providers
        'providers.title': 'Provider Pool Management',
        'providers.note': 'To use default path configuration, add an empty node',
        'providers.activeConnections': 'Active Connections',
        'providers.activeProviders': 'Active Providers',
        'providers.healthyProviders': 'Healthy Providers',
        'providers.status.healthy': '{healthy}/{total} Healthy',
        'providers.status.empty': '0/0 Nodes',
        'providers.stat.totalAccounts': 'Total Accounts',
        'providers.stat.healthyAccounts': 'Healthy Accounts',
        'providers.stat.usageCount': 'Usage Count',
        'providers.stat.errorCount': 'Error Count',
        'providers.auth.generate': 'Gen Auth',

        // Modal Provider Manager
        'modal.provider.manage': 'Manage {type} Provider Config',
        'modal.provider.totalAccounts': 'Total Accounts:',
        'modal.provider.healthyAccounts': 'Healthy Accounts:',
        'modal.provider.add': 'Add Provider',
        'modal.provider.resetHealth': 'Reset Health',
        'modal.provider.healthCheck': 'Health Check',
        'modal.provider.resetHealthConfirm': 'Are you sure you want to reset all {type} nodes to healthy status?\n\nThis will clear error counts and timestamps for all nodes.',
        'modal.provider.healthCheckConfirm': 'Are you sure you want to perform a health check on all {type} nodes?\n\nThis will send test requests to each node to verify availability.',
        'modal.provider.deleteConfirm': 'Are you sure you want to delete this provider config? This cannot be undone.',
        'modal.provider.disableConfirm': 'Are you sure you want to disable this provider? It will no longer be selected for use.',
        'modal.provider.enableConfirm': 'Are you sure you want to enable this provider?',
        'modal.provider.edit': 'Edit',
        'modal.provider.delete': 'Delete',
        'modal.provider.save': 'Save',
        'modal.provider.cancel': 'Cancel',
        'modal.provider.status.healthy': 'Normal',
        'modal.provider.status.unhealthy': 'Abnormal',
        'modal.provider.status.disabled': 'Disabled',
        'modal.provider.status.enabled': 'Enabled',
        'modal.provider.lastError': 'Last Error:',
        'modal.provider.lastUsed': 'Last Used:',
        'modal.provider.lastCheck': 'Last Check:',
        'modal.provider.checkModel': 'Check Model:',
        'modal.provider.usageCount': 'Usage Count:',
        'modal.provider.errorCount': 'Error Count:',
        'modal.provider.neverUsed': 'Never Used',
        'modal.provider.neverChecked': 'Never Checked',
        'modal.provider.noModels': 'No models available for this provider type',
        'modal.provider.loadingModels': 'Loading models...',
        'modal.provider.unsupportedModels': 'Unsupported Models',
        'modal.provider.unsupportedModelsHelp': 'Select models not supported by this provider; they will be excluded automatically',
        'modal.provider.addTitle': 'Add New Provider Config',
        'modal.provider.customName': 'Custom Name',
        'modal.provider.checkModelName': 'Check Model Name',
        'modal.provider.healthCheckLabel': 'Health Check',
        'modal.provider.enabled': 'Enabled',
        'modal.provider.disabled': 'Disabled',
        'modal.provider.noProviderType': 'Unsupported provider type',

        'modal.provider.load.failed': 'Failed to load provider details',
        'modal.provider.auth.initializing': 'Initializing credential generation...',
        'modal.provider.auth.success': 'Credentials generated and path auto-filled',
        'modal.provider.auth.window': 'Please complete authorization in the opened window',
        'modal.provider.auth.failed': 'Failed to initialize credential generation',
        'modal.provider.save.success': 'Save successful',
        'modal.provider.save.failed': 'Save failed',
        'modal.provider.delete.success': 'Delete successful',
        'modal.provider.delete.failed': 'Delete failed',
        'modal.provider.add.success': 'Add successful',
        'modal.provider.add.failed': 'Add failed',
        'modal.provider.resetHealth.success': 'Successfully reset health status for {count} nodes',
        'modal.provider.resetHealth.failed': 'Failed to reset health status',
        'modal.provider.kiroAuthHint': 'When using AWS Builder ID login, <code>clientId</code> and <code>clientSecret</code> fields are required, which can be found in another JSON file in the same folder',
        
        // Pagination
        'pagination.showing': 'Showing {start}-{end} of {total}',
        'pagination.jumpTo': 'Jump to',
        'pagination.page': 'Page',
        
        // Usage
        'usage.title': 'Usage Query',
        'usage.refresh': 'Refresh Usage',
        'usage.lastUpdate': 'Last Update: {time}',
        'usage.lastUpdateCache': 'Cache Time: {time}',
        'usage.loading': 'Loading usage data...',
        'usage.empty': 'Click "Refresh Usage" button to get authorization file usage information',
        'usage.noData': 'No usage data available',
        'usage.noInstances': 'No initialized service instances',
        'usage.group.instances': '{count} instances',
        'usage.group.success': '{count}/{total} Success',
        'usage.card.status.disabled': 'Disabled',
        'usage.card.status.healthy': 'Healthy',
        'usage.card.status.unhealthy': 'Abnormal',
        'usage.card.totalUsage': 'Total Usage',
        'usage.card.freeTrial': 'Free Trial',
        'usage.card.bonus': 'Bonus',
        'usage.card.expires': 'Expires: {time}',
        'usage.group.expandAll': 'Expand All Cards',
        'usage.group.collapseAll': 'Collapse All Cards',
        
        // Logs
        'logs.title': 'Real-time Logs',
        'logs.clear': 'Clear Logs',
        'logs.autoScroll': 'Auto Scroll',
        'logs.autoScroll.on': 'Auto Scroll: On',
        'logs.autoScroll.off': 'Auto Scroll: Off',
        
        // Plugins
        'plugins.title': 'Plugin Management',
        'plugins.description': 'The plugin system allows you to extend system functionality. Enabling or disabling plugins requires a service restart to take effect.',
        'plugins.stats.total': 'Total Plugins',
        'plugins.stats.enabled': 'Enabled',
        'plugins.stats.disabled': 'Disabled',
        'plugins.refresh': 'Refresh Plugins',
        'plugins.loading': 'Loading plugins...',
        'plugins.empty': 'No installed plugins',
        'plugins.noDescription': 'No description',
        'plugins.status.enabled': 'Enabled',
        'plugins.status.disabled': 'Disabled',
        'plugins.badge.middleware.title': 'Contains Middleware',
        'plugins.badge.routes.title': 'Contains Routes',
        'plugins.badge.hooks.title': 'Contains Hooks',
        'plugins.toggle.success': 'Plugin {name} {status}',
        'plugins.toggle.failed': 'Failed to toggle plugin status',
        'plugins.load.failed': 'Failed to load plugins list',
        'plugins.restart.required': 'Changes saved, please restart service to take effect',

        // Common
        'common.togglePassword': 'Show/Hide Password',
        'common.confirm': 'Confirm',
        'common.cancel': 'Cancel',
        'common.success': 'Success',
        'common.enabled': 'Enabled',
        'common.disabled': 'Disabled',
        'common.error': 'Error',
        'common.warning': 'Warning',
        'common.info': 'Info',
        'common.loading': 'Loading...',
        'common.upload': 'Upload',
        'common.generate': 'Generate',
        'common.found': 'Found',
        'common.missing': 'Missing',
        'common.search': 'Search',
        'common.welcome': 'Welcome to AIClient2API Management Console!',
        'common.fileType': 'Unsupported file type. Please select JSON, TXT, KEY, PEM, P12, or PFX.',
        'common.fileSize': 'File size cannot exceed 5MB.',
        'common.uploadSuccess': 'File uploaded successfully',
        'common.uploadFailed': 'File upload failed',
        'common.passwordUpdated': 'Admin password updated, takes effect next login',
        'common.configSaved': 'Configuration saved',
        'common.providerPoolRefreshed': 'Provider pool data refreshed',
        'common.copy.success': 'Content copied to clipboard',
        'common.copy.failed': 'Copy failed, please copy manually',
        'common.refresh.success': 'Refresh successful',
        'common.refresh.failed': 'Refresh failed',
        
        // Login
        'login.title': 'Login - AIClient2API',
        'login.heading': 'Please login to continue',
        'login.password': 'Password',
        'login.passwordPlaceholder': 'Please enter password',
        'login.error.empty': 'Please enter password',
        'login.error.incorrect': 'Incorrect password, please try again',
        'login.error.failed': 'Login failed, please check your network connection',
        'login.button': 'Login',
        'login.loggingIn': 'Logging in...',
    }
};

// 当前语言
let currentLanguage = localStorage.getItem('language') || 'zh-CN';

// 获取翻译文本
export function t(key, params = {}) {
    let text = translations[currentLanguage]?.[key] || translations['zh-CN']?.[key] || key;
    
    // 替换参数
    Object.keys(params).forEach(param => {
        text = text.replace(`{${param}}`, params[param]);
    });
    
    return text;
}

// 切换语言
export function setLanguage(lang) {
    if (translations[lang]) {
        currentLanguage = lang;
        localStorage.setItem('language', lang);
        updatePageLanguage();
        // 更新图片
        updateDashboardImages(lang);
        // 触发语言切换事件
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    }
}

// 更新仪表盘图片
function updateDashboardImages(lang) {
    const sponsorImg = document.getElementById('sponsor-img');
    const sponsorTitle = document.getElementById('sponsor-title');
    const sponsorDesc = document.getElementById('sponsor-desc');
    
    const wechatImg = document.getElementById('wechat-img');
    const wechatIcon = document.getElementById('wechat-icon');
    const wechatTitle = document.getElementById('wechat-title');
    const wechatDesc = document.getElementById('wechat-desc');

    if (lang === 'en-US') {
        // 更新赞助图片
        if (sponsorImg) {
            sponsorImg.src = 'static/coffee.png';
            sponsorImg.alt = 'Buy me a coffee';
            if (sponsorTitle) {
                sponsorTitle.setAttribute('data-i18n', 'dashboard.contact.coffee');
                sponsorTitle.textContent = translations['en-US']['dashboard.contact.coffee'];
            }
            if (sponsorDesc) {
                sponsorDesc.setAttribute('data-i18n', 'dashboard.contact.coffeeDesc');
                sponsorDesc.textContent = translations['en-US']['dashboard.contact.coffeeDesc'];
            }
        }
        
        // 更新联系方式图片 (WeChat -> X.com)
        if (wechatImg) {
            wechatImg.src = 'static/x.com.png';
            wechatImg.alt = 'X.com';
            if (wechatIcon) {
                wechatIcon.className = 'fab fa-x-twitter';
            }
            if (wechatTitle) {
                wechatTitle.setAttribute('data-i18n', 'dashboard.contact.x');
                wechatTitle.textContent = translations['en-US']['dashboard.contact.x'] || 'Follow on X.com';
            }
            if (wechatDesc) {
                wechatDesc.setAttribute('data-i18n', 'dashboard.contact.xDesc');
                wechatDesc.textContent = translations['en-US']['dashboard.contact.xDesc'] || 'Follow us on X for latest updates';
            }
        }
    } else {
        // 更新赞助图片
        if (sponsorImg) {
            sponsorImg.src = 'static/sponsor.png';
            sponsorImg.alt = '赞助二维码';
            if (sponsorTitle) {
                sponsorTitle.setAttribute('data-i18n', 'dashboard.contact.sponsor');
                sponsorTitle.textContent = translations['zh-CN']['dashboard.contact.sponsor'];
            }
            if (sponsorDesc) {
                sponsorDesc.setAttribute('data-i18n', 'dashboard.contact.sponsorDesc');
                sponsorDesc.textContent = translations['zh-CN']['dashboard.contact.sponsorDesc'];
            }
        }

        // 更新联系方式图片 (X.com -> WeChat)
        if (wechatImg) {
            wechatImg.src = 'static/wechat.png';
            wechatImg.alt = '微信二维码';
            if (wechatIcon) {
                wechatIcon.className = 'fab fa-weixin';
            }
            if (wechatTitle) {
                wechatTitle.setAttribute('data-i18n', 'dashboard.contact.wechat');
                wechatTitle.textContent = translations['zh-CN']['dashboard.contact.wechat'];
            }
            if (wechatDesc) {
                wechatDesc.setAttribute('data-i18n', 'dashboard.contact.wechatDesc');
                wechatDesc.textContent = translations['zh-CN']['dashboard.contact.wechatDesc'];
            }
        }
    }
}

// 获取当前语言
export function getCurrentLanguage() {
    return currentLanguage;
}

// 更新页面语言
function updatePageLanguage() {
    // 更新 HTML lang 属性
    document.documentElement.lang = currentLanguage;
    
    // 更新所有带 data-i18n 或 data-i18n-xxx 属性的元素
    document.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]').forEach(element => {
        // 1. 处理属性翻译 (placeholder, title, aria-label)
        const attributes = ['placeholder', 'title', 'aria-label'];
        attributes.forEach(attr => {
            const attrKey = element.getAttribute(`data-i18n-${attr}`);
            if (attrKey) {
                const params = element.getAttribute(`data-i18n-${attr}-params`);
                const parsedParams = params ? JSON.parse(params) : {};
                if (attr === 'aria-label') {
                    element.setAttribute('aria-label', t(attrKey, parsedParams));
                } else {
                    element[attr] = t(attrKey, parsedParams);
                }
            }
        });

        // 2. 处理主文本翻译 (data-i18n)
        const key = element.getAttribute('data-i18n');
        if (key) {
            const params = element.getAttribute('data-i18n-params');
            const parsedParams = params ? JSON.parse(params) : {};
            
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                // 如果没有显式的 data-i18n-placeholder，则 data-i18n 作用于 placeholder
                if (!element.hasAttribute('data-i18n-placeholder')) {
                    element.placeholder = t(key, parsedParams);
                }
            } else {
                element.textContent = t(key, parsedParams);
            }
        }
    });
    
    // 更新所有带 data-i18n-html 属性的元素（支持 HTML 内容）
    document.querySelectorAll('[data-i18n-html]').forEach(element => {
        const key = element.getAttribute('data-i18n-html');
        const params = element.getAttribute('data-i18n-params');
        const parsedParams = params ? JSON.parse(params) : {};
        element.innerHTML = t(key, parsedParams);
    });
}

// 初始化多语言
export function initI18n() {
    // 设置初始语言
    updatePageLanguage();
    // 设置初始图片
    updateDashboardImages(currentLanguage);
    
    // 监听 DOM 变化，自动翻译新添加的元素
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // 元素节点
                    // 翻译新添加的元素
                    if (node.hasAttribute('data-i18n')) {
                        const key = node.getAttribute('data-i18n');
                        const params = node.getAttribute('data-i18n-params');
                        const parsedParams = params ? JSON.parse(params) : {};
                        
                        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
                            if (node.placeholder !== undefined) {
                                node.placeholder = t(key, parsedParams);
                            }
                        } else {
                            node.textContent = t(key, parsedParams);
                        }
                    }
                    
                    // 翻译子元素
                    node.querySelectorAll('[data-i18n]').forEach(element => {
                        const key = element.getAttribute('data-i18n');
                        const params = element.getAttribute('data-i18n-params');
                        const parsedParams = params ? JSON.parse(params) : {};
                        
                        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                            if (element.placeholder !== undefined) {
                                element.placeholder = t(key, parsedParams);
                            }
                        } else {
                            element.textContent = t(key, parsedParams);
                        }
                    });
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 导出所有函数
export default {
    t,
    setLanguage,
    getCurrentLanguage,
    initI18n
};
