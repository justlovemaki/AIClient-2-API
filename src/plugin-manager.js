/**
 * 插件管理器 - 可插拔插件系统核心
 * 
 * 功能：
 * 1. 插件注册与加载
 * 2. 生命周期管理（init/destroy）
 * 3. 扩展点管理（中间件、路由、钩子）
 * 4. 插件配置管理
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

// 插件配置文件路径
const PLUGINS_CONFIG_FILE = path.join(process.cwd(), 'configs', 'plugins.json');

/**
 * 插件类型常量
 */
export const PLUGIN_TYPE = {
    AUTH: 'auth',           // 认证插件，参与认证流程
    MIDDLEWARE: 'middleware' // 普通中间件，不参与认证
};

/**
 * 插件接口定义（JSDoc 类型）
 * @typedef {Object} Plugin
 * @property {string} name - 插件名称（唯一标识）
 * @property {string} version - 插件版本
 * @property {string} [description] - 插件描述
 * @property {string} [type] - 插件类型：'auth'（认证插件）或 'middleware'（普通中间件，默认）
 * @property {boolean} [enabled] - 是否启用（默认 true）
 * @property {number} [_priority] - 优先级，数字越小越先执行（默认 100）
 * @property {boolean} [_builtin] - 是否为内置插件（内置插件最后执行）
 * @property {Function} [init] - 初始化钩子 (config) => Promise<void>
 * @property {Function} [destroy] - 销毁钩子 () => Promise<void>
 * @property {Function} [middleware] - 请求中间件 (req, res, requestUrl, config) => Promise<{handled: boolean, data?: Object}>
 * @property {Function} [authenticate] - 认证方法（仅 type='auth' 时有效）(req, res, requestUrl, config) => Promise<{handled: boolean, authorized: boolean|null, error?: Object, data?: Object}>
 * @property {Array<{method: string, path: string|RegExp, handler: Function}>} [routes] - 路由定义
 * @property {string[]} [staticPaths] - 静态文件路径（相对于 static 目录）
 * @property {Object} [hooks] - 钩子函数
 * @property {Function} [hooks.onBeforeRequest] - 请求前钩子 (req, config) => Promise<void>
 * @property {Function} [hooks.onAfterResponse] - 响应后钩子 (req, res, config) => Promise<void>
 * @property {Function} [hooks.onContentGenerated] - 内容生成后钩子 (config) => Promise<void>
 */

/**
 * 插件管理器类
 */
class PluginManager {
    constructor() {
        /** @type {Map<string, Plugin>} */
        this.plugins = new Map();
        /** @type {Object} */
        this.pluginsConfig = { plugins: {} };
        /** @type {boolean} */
        this.initialized = false;
    }

    /**
     * 加载插件配置文件
     */
    async loadConfig() {
        try {
            if (existsSync(PLUGINS_CONFIG_FILE)) {
                const content = await fs.readFile(PLUGINS_CONFIG_FILE, 'utf8');
                this.pluginsConfig = JSON.parse(content);
            } else {
                // 扫描 plugins 目录生成默认配置
                this.pluginsConfig = await this.generateDefaultConfig();
                await this.saveConfig();
            }
        } catch (error) {
            console.error('[PluginManager] Failed to load config:', error.message);
            this.pluginsConfig = { plugins: {} };
        }
    }

    /**
     * 扫描 plugins 目录生成默认配置
     * @returns {Promise<Object>} 默认插件配置
     */
    async generateDefaultConfig() {
        const defaultConfig = { plugins: {} };
        const pluginsDir = path.join(process.cwd(), 'src', 'plugins');
        
        try {
            if (!existsSync(pluginsDir)) {
                return defaultConfig;
            }
            
            const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                
                const pluginPath = path.join(pluginsDir, entry.name, 'index.js');
                if (!existsSync(pluginPath)) continue;
                
                try {
                    // 动态导入插件以获取其元信息
                    const pluginModule = await import(`file://${pluginPath}`);
                    const plugin = pluginModule.default || pluginModule;
                    
                    if (plugin && plugin.name) {
                        defaultConfig.plugins[plugin.name] = {
                            enabled: true,
                            description: plugin.description || ''
                        };
                        console.log(`[PluginManager] Found plugin for default config: ${plugin.name}`);
                    }
                } catch (importError) {
                    // 如果导入失败，使用目录名作为插件名
                    defaultConfig.plugins[entry.name] = {
                        enabled: true,
                        description: ''
                    };
                    console.warn(`[PluginManager] Could not import plugin ${entry.name}, using directory name:`, importError.message);
                }
            }
        } catch (error) {
            console.error('[PluginManager] Failed to scan plugins directory:', error.message);
        }
        
        return defaultConfig;
    }

    /**
     * 保存插件配置文件
     */
    async saveConfig() {
        try {
            const dir = path.dirname(PLUGINS_CONFIG_FILE);
            if (!existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            await fs.writeFile(PLUGINS_CONFIG_FILE, JSON.stringify(this.pluginsConfig, null, 2), 'utf8');
        } catch (error) {
            console.error('[PluginManager] Failed to save config:', error.message);
        }
    }

    /**
     * 注册插件
     * @param {Plugin} plugin - 插件对象
     */
    register(plugin) {
        if (!plugin.name) {
            throw new Error('Plugin must have a name');
        }
        if (this.plugins.has(plugin.name)) {
            console.warn(`[PluginManager] Plugin "${plugin.name}" is already registered, skipping`);
            return;
        }
        this.plugins.set(plugin.name, plugin);
        console.log(`[PluginManager] Registered plugin: ${plugin.name} v${plugin.version || '1.0.0'}`);
    }

    /**
     * 初始化所有已启用的插件
     * @param {Object} config - 服务器配置
     */
    async initAll(config) {
        await this.loadConfig();
        
        for (const [name, plugin] of this.plugins) {
            const pluginConfig = this.pluginsConfig.plugins[name] || {};
            const enabled = pluginConfig.enabled !== false; // 默认启用
            
            if (!enabled) {
                console.log(`[PluginManager] Plugin "${name}" is disabled, skipping init`);
                continue;
            }

            try {
                if (typeof plugin.init === 'function') {
                    await plugin.init(config);
                    console.log(`[PluginManager] Initialized plugin: ${name}`);
                }
                plugin._enabled = true;
            } catch (error) {
                console.error(`[PluginManager] Failed to init plugin "${name}":`, error.message);
                plugin._enabled = false;
            }
        }
        
        this.initialized = true;
    }

    /**
     * 销毁所有插件
     */
    async destroyAll() {
        for (const [name, plugin] of this.plugins) {
            if (!plugin._enabled) continue;
            
            try {
                if (typeof plugin.destroy === 'function') {
                    await plugin.destroy();
                    console.log(`[PluginManager] Destroyed plugin: ${name}`);
                }
            } catch (error) {
                console.error(`[PluginManager] Failed to destroy plugin "${name}":`, error.message);
            }
        }
        this.initialized = false;
    }

    /**
     * 检查插件是否启用
     * @param {string} name - 插件名称
     * @returns {boolean}
     */
    isEnabled(name) {
        const plugin = this.plugins.get(name);
        return plugin && plugin._enabled === true;
    }

    /**
     * 获取所有启用的插件（按优先级排序）
     * 优先级数字越小越先执行，内置插件（_builtin: true）最后执行
     * @returns {Plugin[]}
     */
    getEnabledPlugins() {
        return Array.from(this.plugins.values())
            .filter(p => p._enabled)
            .sort((a, b) => {
                // 内置插件排在最后
                const aBuiltin = a._builtin ? 1 : 0;
                const bBuiltin = b._builtin ? 1 : 0;
                if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
                
                // 按优先级排序（数字越小越先执行）
                const aPriority = a._priority || 100;
                const bPriority = b._priority || 100;
                return aPriority - bPriority;
            });
    }

    /**
     * 获取所有认证插件（按优先级排序）
     * @returns {Plugin[]}
     */
    getAuthPlugins() {
        return this.getEnabledPlugins().filter(p =>
            p.type === PLUGIN_TYPE.AUTH && typeof p.authenticate === 'function'
        );
    }

    /**
     * 获取所有普通中间件插件（按优先级排序）
     * @returns {Plugin[]}
     */
    getMiddlewarePlugins() {
        return this.getEnabledPlugins().filter(p =>
            p.type !== PLUGIN_TYPE.AUTH && typeof p.middleware === 'function'
        );
    }

    /**
     * 执行认证流程
     * 只有 type='auth' 的插件会参与认证
     *
     * 认证插件返回值说明：
     * - { handled: true } - 请求已被处理（如发送了错误响应），停止后续处理
     * - { authorized: true, data: {...} } - 认证成功，可附带数据
     * - { authorized: false } - 认证失败，已发送错误响应
     * - { authorized: null } - 此插件不处理该请求，继续下一个认证插件
     *
     * @param {http.IncomingMessage} req - HTTP 请求
     * @param {http.ServerResponse} res - HTTP 响应
     * @param {URL} requestUrl - 解析后的 URL
     * @param {Object} config - 服务器配置
     * @returns {Promise<{handled: boolean, authorized: boolean}>}
     */
    async executeAuth(req, res, requestUrl, config) {
        const authPlugins = this.getAuthPlugins();
        
        for (const plugin of authPlugins) {
            try {
                const result = await plugin.authenticate(req, res, requestUrl, config);
                
                if (!result) continue;
                
                // 如果请求已被处理（如发送了错误响应），停止执行
                if (result.handled) {
                    return { handled: true, authorized: false };
                }
                
                // 如果认证失败，停止执行
                if (result.authorized === false) {
                    return { handled: true, authorized: false };
                }
                
                // 如果认证成功，合并数据并返回
                if (result.authorized === true) {
                    if (result.data) {
                        Object.assign(config, result.data);
                    }
                    return { handled: false, authorized: true };
                }
                
                // authorized === null 表示此插件不处理，继续下一个
            } catch (error) {
                console.error(`[PluginManager] Auth error in plugin "${plugin.name}":`, error.message);
            }
        }
        
        // 没有任何认证插件处理，返回未授权
        return { handled: false, authorized: false };
    }

    /**
     * 执行普通中间件
     * 只有 type!='auth' 的插件会执行
     *
     * 中间件返回值说明：
     * - { handled: true } - 请求已被处理，停止后续处理
     * - { handled: false, data: {...} } - 继续处理，可附带数据
     * - null/undefined - 继续执行下一个中间件
     *
     * @param {http.IncomingMessage} req - HTTP 请求
     * @param {http.ServerResponse} res - HTTP 响应
     * @param {URL} requestUrl - 解析后的 URL
     * @param {Object} config - 服务器配置
     * @returns {Promise<{handled: boolean}>}
     */
    async executeMiddleware(req, res, requestUrl, config) {
        const middlewarePlugins = this.getMiddlewarePlugins();
        
        for (const plugin of middlewarePlugins) {
            try {
                const result = await plugin.middleware(req, res, requestUrl, config);
                
                if (!result) continue;
                
                // 如果请求已被处理，停止执行
                if (result.handled) {
                    return { handled: true };
                }
                
                // 合并数据
                if (result.data) {
                    Object.assign(config, result.data);
                }
            } catch (error) {
                console.error(`[PluginManager] Middleware error in plugin "${plugin.name}":`, error.message);
            }
        }
        
        return { handled: false };
    }

    /**
     * 执行所有插件的路由处理
     * @param {string} method - HTTP 方法
     * @param {string} path - 请求路径
     * @param {http.IncomingMessage} req - HTTP 请求
     * @param {http.ServerResponse} res - HTTP 响应
     * @returns {Promise<boolean>} - 是否已处理
     */
    async executeRoutes(method, path, req, res) {
        for (const plugin of this.getEnabledPlugins()) {
            if (!Array.isArray(plugin.routes)) continue;
            
            for (const route of plugin.routes) {
                const methodMatch = route.method === '*' || route.method.toUpperCase() === method;
                if (!methodMatch) continue;
                
                let pathMatch = false;
                if (route.path instanceof RegExp) {
                    pathMatch = route.path.test(path);
                } else if (typeof route.path === 'string') {
                    pathMatch = path === route.path || path.startsWith(route.path + '/');
                }
                
                if (pathMatch) {
                    try {
                        const handled = await route.handler(method, path, req, res);
                        if (handled) return true;
                    } catch (error) {
                        console.error(`[PluginManager] Route error in plugin "${plugin.name}":`, error.message);
                    }
                }
            }
        }
        return false;
    }

    /**
     * 获取所有插件的静态文件路径
     * @returns {string[]}
     */
    getStaticPaths() {
        const paths = [];
        for (const plugin of this.getEnabledPlugins()) {
            if (Array.isArray(plugin.staticPaths)) {
                paths.push(...plugin.staticPaths);
            }
        }
        return paths;
    }

    /**
     * 检查路径是否是插件静态文件
     * @param {string} path - 请求路径
     * @returns {boolean}
     */
    isPluginStaticPath(path) {
        const staticPaths = this.getStaticPaths();
        return staticPaths.some(sp => path === sp || path === '/' + sp);
    }

    /**
     * 执行钩子函数
     * @param {string} hookName - 钩子名称
     * @param  {...any} args - 钩子参数
     */
    async executeHook(hookName, ...args) {
        for (const plugin of this.getEnabledPlugins()) {
            if (!plugin.hooks || typeof plugin.hooks[hookName] !== 'function') continue;
            
            try {
                await plugin.hooks[hookName](...args);
            } catch (error) {
                console.error(`[PluginManager] Hook "${hookName}" error in plugin "${plugin.name}":`, error.message);
            }
        }
    }

    /**
     * 获取插件列表（用于 API）
     * @returns {Object[]}
     */
    getPluginList() {
        const list = [];
        for (const [name, plugin] of this.plugins) {
            const pluginConfig = this.pluginsConfig.plugins[name] || {};
            list.push({
                name: plugin.name,
                version: plugin.version || '1.0.0',
                description: plugin.description || pluginConfig.description || '',
                enabled: plugin._enabled === true,
                hasMiddleware: typeof plugin.middleware === 'function',
                hasRoutes: Array.isArray(plugin.routes) && plugin.routes.length > 0,
                hasHooks: plugin.hooks && Object.keys(plugin.hooks).length > 0
            });
        }
        return list;
    }

    /**
     * 启用/禁用插件
     * @param {string} name - 插件名称
     * @param {boolean} enabled - 是否启用
     */
    async setPluginEnabled(name, enabled) {
        if (!this.pluginsConfig.plugins[name]) {
            this.pluginsConfig.plugins[name] = {};
        }
        this.pluginsConfig.plugins[name].enabled = enabled;
        await this.saveConfig();
        
        const plugin = this.plugins.get(name);
        if (plugin) {
            plugin._enabled = enabled;
        }
    }
}

// 单例实例
const pluginManager = new PluginManager();

/**
 * 自动发现并加载插件
 * 扫描 src/plugins/ 目录下的所有插件
 */
export async function discoverPlugins() {
    const pluginsDir = path.join(process.cwd(), 'src', 'plugins');
    
    try {
        if (!existsSync(pluginsDir)) {
            await fs.mkdir(pluginsDir, { recursive: true });
            console.log('[PluginManager] Created plugins directory');
        }
        
        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            
            const pluginPath = path.join(pluginsDir, entry.name, 'index.js');
            if (!existsSync(pluginPath)) continue;
            
            try {
                // 动态导入插件
                const pluginModule = await import(`file://${pluginPath}`);
                const plugin = pluginModule.default || pluginModule;
                
                if (plugin && plugin.name) {
                    pluginManager.register(plugin);
                }
            } catch (error) {
                console.error(`[PluginManager] Failed to load plugin from ${entry.name}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[PluginManager] Failed to discover plugins:', error.message);
    }
}

/**
 * 获取插件管理器实例
 * @returns {PluginManager}
 */
export function getPluginManager() {
    return pluginManager;
}

// 导出类和实例
export { PluginManager, pluginManager };