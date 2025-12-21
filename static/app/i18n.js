// 多语言配置
const translations = {
    'zh-CN': {
        // Header
        'header.title': 'AIClient2API 管理控制台',
        'header.status.connecting': '连接中...',
        'header.status.connected': '已连接',
        'header.status.disconnected': '连接断开',
        'header.logout': '登出',
        'header.refresh': '重载',
        
        // Navigation
        'nav.main': '主导航',
        'nav.dashboard': '仪表盘',
        'nav.config': '配置管理',
        'nav.providers': '提供商池管理',
        'nav.upload': '上传配置管理',
        'nav.usage': '用量查询',
        'nav.logs': '实时日志',
        
        // Dashboard
        'dashboard.title': '系统概览',
        'dashboard.uptime': '运行时间',
        'dashboard.systemInfo': '系统信息',
        'dashboard.nodeVersion': 'Node.js版本',
        'dashboard.serverTime': '服务器时间',
        'dashboard.memoryUsage': '内存使用',
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

        // Config
        'config.title': '配置管理',
        'config.apiKey': 'API密钥',
        'config.apiKeyPlaceholder': '请输入API密钥',
        'config.host': '监听地址',
        'config.port': '端口',
        'config.modelProvider': '模型提供商',
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
        'config.advanced.systemPromptFilePlaceholder': '例如: input_system_prompt.txt',
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
        'config.advanced.poolFilePathPlaceholder': '默认: provider_pools.json',
        'config.advanced.poolNote': '配置了提供商池后，默认使用提供商池的配置，提供商池配置失效降级到默认配置',
        'config.advanced.maxErrorCount': '提供商最大错误次数',
        'config.advanced.maxErrorCountPlaceholder': '默认: 3',
        'config.advanced.maxErrorCountNote': '提供商连续错误达到此次数后将被标记为不健康，默认为 3 次',
        'config.advanced.systemPrompt': '系统提示',
        'config.advanced.systemPromptPlaceholder': '输入系统提示...',
        'config.advanced.adminPassword': '后台登录密码',
        'config.advanced.adminPasswordPlaceholder': '设置后台登录密码（留空则不修改）',
        'config.advanced.adminPasswordNote': '用于保护管理控制台的访问，修改后需要重新登录',
        'config.save': '保存配置',
        'config.reset': '重置',
        'config.placeholder.nodeName': '例如: 我的节点1',
        'config.placeholder.model': '例如: gpt-3.5-turbo',
        
        // Upload Config
        'upload.title': '上传配置管理',
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
        'providers.note': '配置了提供商池后，默认使用提供商池的配置，提供商池配置失效降级到默认配置',
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
        
        // Logs
        'logs.title': '实时日志',
        'logs.clear': '清空日志',
        'logs.autoScroll': '自动滚动',
        'logs.autoScroll.on': '自动滚动: 开',
        'logs.autoScroll.off': '自动滚动: 关',
        
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
        'header.status.connecting': 'Connecting...',
        'header.status.connected': 'Connected',
        'header.status.disconnected': 'Disconnected',
        'header.logout': 'Logout',
        'header.refresh': 'Reload',
        
        // Navigation
        'nav.main': 'Main Navigation',
        'nav.dashboard': 'Dashboard',
        'nav.config': 'Configuration',
        'nav.providers': 'Provider Pools',
        'nav.upload': 'Upload Config',
        'nav.usage': 'Usage Query',
        'nav.logs': 'Real-time Logs',
        
        // Dashboard
        'dashboard.title': 'System Overview',
        'dashboard.uptime': 'Uptime',
        'dashboard.systemInfo': 'System Information',
        'dashboard.nodeVersion': 'Node.js Version',
        'dashboard.serverTime': 'Server Time',
        'dashboard.memoryUsage': 'Memory Usage',
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

        // Config
        'config.title': 'Configuration Management',
        'config.apiKey': 'API Key',
        'config.apiKeyPlaceholder': 'Please enter API key',
        'config.host': 'Listen Address',
        'config.port': 'Port',
        'config.modelProvider': 'Model Provider',
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
        'config.advanced.systemPromptFilePlaceholder': 'e.g.: input_system_prompt.txt',
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
        'config.advanced.poolFilePathPlaceholder': 'Default: provider_pools.json',
        'config.advanced.poolNote': 'When provider pool is configured, it will be used by default. Falls back to default config if pool config fails',
        'config.advanced.maxErrorCount': 'Provider Max Error Count',
        'config.advanced.maxErrorCountPlaceholder': 'Default: 3',
        'config.advanced.maxErrorCountNote': 'Provider will be marked as unhealthy after consecutive errors reach this count, default is 3',
        'config.advanced.systemPrompt': 'System Prompt',
        'config.advanced.systemPromptPlaceholder': 'Enter system prompt...',
        'config.advanced.adminPassword': 'Admin Password',
        'config.advanced.adminPasswordPlaceholder': 'Set admin password (leave empty to keep unchanged)',
        'config.advanced.adminPasswordNote': 'Used to protect management console access, requires re-login after modification',
        'config.save': 'Save Configuration',
        'config.reset': 'Reset',
        'config.placeholder.nodeName': 'e.g.: My Node 1',
        'config.placeholder.model': 'e.g.: gpt-3.5-turbo',
        
        // Upload Config
        'upload.title': 'Upload Configuration Management',
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
        'providers.note': 'When provider pool is configured, it will be used by default. Falls back to default config if pool config fails',
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
        
        // Logs
        'logs.title': 'Real-time Logs',
        'logs.clear': 'Clear Logs',
        'logs.autoScroll': 'Auto Scroll',
        'logs.autoScroll.on': 'Auto Scroll: On',
        'logs.autoScroll.off': 'Auto Scroll: Off',
        
        // Common
        'common.togglePassword': 'Show/Hide Password',
        'common.confirm': 'Confirm',
        'common.cancel': 'Cancel',
        'common.success': 'Success',
        'common.error': 'Error',
        'common.warning': 'Warning',
        'common.info': 'Info',
        'common.loading': 'Loading...',
        'common.upload': 'Upload',
        'common.generate': 'Generate',
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