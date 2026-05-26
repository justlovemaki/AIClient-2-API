import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求上下文管理工具
 * 使用 AsyncLocalStorage 实现线程级（请求级）变量存储
 */
class RequestContext {
    constructor() {
        this.storage = new AsyncLocalStorage();
    }

    /**
     * 在上下文中运行
     * @param {Object} context - 上下文数据
     * @param {Function} callback - 回调函数
     * @returns {any}
     */
    run(context, callback) {
        return this.storage.run(context || {}, callback);
    }

    /**
     * 获取当前上下文
     * @returns {Object}
     */
    getStore() {
        return this.storage.getStore() || {};
    }

    /**
     * 设置上下文中的值
     * @param {string} key 
     * @param {any} value 
     */
    set(key, value) {
        const store = this.storage.getStore();
        if (store) {
            store[key] = value;
        }
    }

    /**
     * 获取上下文中的值
     * @param {string} key 
     * @returns {any}
     */
    get(key) {
        const store = this.storage.getStore();
        return store ? store[key] : undefined;
    }
}

const requestContext = new RequestContext();
export default requestContext;
