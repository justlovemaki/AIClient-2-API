/**
 * Unit Tests for Security Fixes
 *
 * 这些是不需要运行服务器的纯单元测试
 * 可以直接运行: npm test -- tests/security-fixes.unit.test.js
 */

import { describe, test, expect } from '@jest/globals';

// ========== 模拟 sanitizeProviderData 函数 ==========
function sanitizeProviderData(provider) {
    if (!provider || typeof provider !== 'object') return provider;
    const sanitized = { ...provider };
    if (typeof sanitized.customName === 'string') {
        let name = sanitized.customName;

        // 拒绝包含危险协议
        if (/(?:data|javascript|vbscript)\s*:/i.test(name)) {
            sanitized.customName = '';
            return sanitized;
        }

        // 移除所有 HTML 标签
        name = name.replace(/<[^>]*>/g, '');

        // 移除 HTML 事件处理器属性
        name = name.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

        // 移除潜在的 HTML 实体编码攻击
        name = name.replace(/&[#\w]+;/g, '');

        sanitized.customName = name.trim();
    }
    return sanitized;
}

// ========== 模拟 withTimeout 函数 ==========
function withTimeout(promise, ms = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
        )
    ]);
}

// ========== 模拟路径验证逻辑 ==========
import path from 'path';

function validatePath(inputPath, cwd) {
    const resolved = path.resolve(cwd, inputPath);
    const relativePath = path.relative(cwd, resolved);
    const isInsideCwd = !path.isAbsolute(relativePath) && !relativePath.startsWith('..') && relativePath !== '..';

    const isWindows = process.platform === 'win32';
    const normalizedResolved = (isWindows ? resolved.toLowerCase() : resolved).replace(/\\/g, '/');
    const normalizedCwd = (isWindows ? cwd.toLowerCase() : cwd).replace(/\\/g, '/');
    const startsWithCwd = normalizedResolved.startsWith(normalizedCwd + '/') || normalizedResolved === normalizedCwd;

    return isInsideCwd && startsWithCwd;
}

describe('Unit Tests - sanitizeProviderData', () => {
    test('should remove script tags', () => {
        const input = { customName: '<script>alert("XSS")</script>TestProvider' };
        const result = sanitizeProviderData(input);
        expect(result.customName).not.toContain('<script>');
        expect(result.customName).not.toContain('</script>');
        expect(result.customName).toContain('TestProvider');
    });

    test('should reject javascript: protocol', () => {
        const input = { customName: 'javascript:alert("XSS")' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('');
    });

    test('should reject data: protocol', () => {
        const input = { customName: 'data:text/html,<script>alert(1)</script>' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('');
    });

    test('should reject vbscript: protocol', () => {
        const input = { customName: 'vbscript:msgbox("XSS")' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('');
    });

    test('should remove all HTML tags', () => {
        const input = { customName: '<div><img src=x><span>Test</span></div>' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('Test');
        expect(result.customName).not.toContain('<');
        expect(result.customName).not.toContain('>');
    });

    test('should remove event handlers', () => {
        const input = { customName: 'Test onclick="alert(1)" Provider' };
        const result = sanitizeProviderData(input);
        expect(result.customName).not.toContain('onclick');
        expect(result.customName).toContain('Test');
        expect(result.customName).toContain('Provider');
    });

    test('should remove HTML entities', () => {
        const input = { customName: 'Test&lt;script&gt;Provider&#39;' };
        const result = sanitizeProviderData(input);
        expect(result.customName).not.toContain('&lt;');
        expect(result.customName).not.toContain('&gt;');
        expect(result.customName).not.toContain('&#39;');
    });

    test('should preserve normal text', () => {
        const input = { customName: 'My Test Provider 123' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('My Test Provider 123');
    });

    test('should handle empty string', () => {
        const input = { customName: '' };
        const result = sanitizeProviderData(input);
        expect(result.customName).toBe('');
    });

    test('should handle null/undefined', () => {
        expect(sanitizeProviderData(null)).toBe(null);
        expect(sanitizeProviderData(undefined)).toBe(undefined);
    });

    test('should handle object without customName', () => {
        const input = { uuid: '123', type: 'test' };
        const result = sanitizeProviderData(input);
        expect(result).toEqual(input);
    });

    test('should handle complex XSS vectors', () => {
        const vectors = [
            '<img src=x onerror="alert(1)">',
            '<svg onload="alert(1)">',
            '<iframe src="javascript:alert(1)">',
            '"><script>alert(1)</script>',
        ];

        vectors.forEach(vector => {
            const result = sanitizeProviderData({ customName: vector });
            expect(result.customName).not.toContain('<script>');
            expect(result.customName).not.toContain('onerror');
            expect(result.customName).not.toContain('onload');
            expect(result.customName).not.toContain('javascript');
        });
    });
});

describe('Unit Tests - withTimeout', () => {
    test('should complete before timeout', async () => {
        const fastOperation = Promise.resolve('success');
        const result = await withTimeout(fastOperation, 1000);
        expect(result).toBe('success');
    });

    test('should reject slow operations after timeout', async () => {
        const slowOperation = new Promise(resolve => setTimeout(() => resolve('done'), 2000));
        await expect(withTimeout(slowOperation, 100)).rejects.toThrow('Operation timeout after 100ms');
    });

    test('should use default timeout of 30 seconds', async () => {
        const slowOperation = new Promise(resolve => setTimeout(() => resolve('done'), 35000));
        await expect(withTimeout(slowOperation)).rejects.toThrow('Operation timeout after 30000ms');
    }, 35000);

    test('should propagate operation errors', async () => {
        const failingOperation = Promise.reject(new Error('Operation failed'));
        await expect(withTimeout(failingOperation, 1000)).rejects.toThrow('Operation failed');
    });
});

describe('Unit Tests - Path Validation', () => {
    test('should accept paths within working directory', () => {
        const cwd = process.platform === 'win32' ? 'C:\\Users\\Test\\Project' : '/home/user/project';
        expect(validatePath('configs/test.txt', cwd)).toBe(true);
        expect(validatePath('./configs/test.txt', cwd)).toBe(true);
        expect(validatePath('test.txt', cwd)).toBe(true);
    });

    test('should reject paths with directory traversal', () => {
        const cwd = process.platform === 'win32' ? 'C:\\Users\\Test\\Project' : '/home/user/project';
        expect(validatePath('../../../etc/passwd', cwd)).toBe(false);
        expect(validatePath('configs/../../etc/passwd', cwd)).toBe(false);
    });

    test('should reject absolute paths outside working directory', () => {
        const cwd = process.platform === 'win32' ? 'C:\\Users\\Test\\Project' : '/home/user/project';
        expect(validatePath('/etc/passwd', cwd)).toBe(false);
        expect(validatePath('/tmp/test.txt', cwd)).toBe(false);
    });

    test('should handle Windows paths correctly', () => {
        if (process.platform === 'win32') {
            const cwd = 'C:\\Users\\Test\\Project';
            expect(validatePath('configs\\test.txt', cwd)).toBe(true);
            expect(validatePath('CONFIGS\\TEST.TXT', cwd)).toBe(true);
        }
    });
});
