import { getPluginManager } from '../core/plugin-manager.js';
import { getRequestBody } from '../utils/common.js';
import { broadcastEvent } from './event-broadcast.js';

/**
 * 获取插件列表
 */
export async function handleGetPlugins(req, res) {
    try {
        const pluginManager = getPluginManager();
        const plugins = pluginManager.getPluginList();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plugins }));
        return true;
    } catch (error) {
        console.error('[UI API] Failed to get plugins:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to get plugins list: ' + error.message
            }
        }));
        return true;
    }
}

/**
 * 切换插件状态
 */
export async function handleTogglePlugin(req, res, pluginName) {
    try {
        const body = await getRequestBody(req);
        const { enabled } = body;

        if (typeof enabled !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: 'Enabled status must be a boolean'
                }
            }));
            return true;
        }

        const pluginManager = getPluginManager();
        await pluginManager.setPluginEnabled(pluginName, enabled);

        // 广播更新事件
        broadcastEvent('plugin_update', {
            action: 'toggle',
            pluginName,
            enabled,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `Plugin ${pluginName} ${enabled ? 'enabled' : 'disabled'} successfully`,
            plugin: {
                name: pluginName,
                enabled
            }
        }));
        return true;
    } catch (error) {
        console.error('[UI API] Failed to toggle plugin:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Failed to toggle plugin: ' + error.message
            }
        }));
        return true;
    }
}