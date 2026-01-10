import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Token存储到本地文件中
const TOKEN_STORE_FILE = path.join(process.cwd(), 'configs', 'token-store.json');

/**
 * 默认密码（当pwd文件不存在时使用）
 */
const DEFAULT_PASSWORD = 'admin123';

/**
 * 读取密码文件内容
 * 如果文件不存在或读取失败，返回默认密码
 */
export async function readPasswordFile() {
    const pwdFilePath = path.join(process.cwd(), 'configs', 'pwd');
    try {
        // 使用异步方式检查文件是否存在并读取，避免竞态条件
        const password = await fs.readFile(pwdFilePath, 'utf8');
        const trimmedPassword = password.trim();
        // 如果密码文件为空，使用默认密码
        if (!trimmedPassword) {
            console.log('[Auth] Password file is empty, using default password: ' + DEFAULT_PASSWORD);
            return DEFAULT_PASSWORD;
        }
        console.log('[Auth] Successfully read password file');
        return trimmedPassword;
    } catch (error) {
        // ENOENT means file does not exist, which is normal
        if (error.code === 'ENOENT') {
            console.log('[Auth] Password file does not exist, using default password: ' + DEFAULT_PASSWORD);
        } else {
            console.error('[Auth] Failed to read password file:', error.code || error.message);
            console.log('[Auth] Using default password: ' + DEFAULT_PASSWORD);
        }
        return DEFAULT_PASSWORD;
    }
}

/**
 * 验证登录凭据
 */
export async function validateCredentials(password) {
    const storedPassword = await readPasswordFile();
    console.log('[Auth] Validating password, stored password length:', storedPassword ? storedPassword.length : 0, ', input password length:', password ? password.length : 0);
    const isValid = storedPassword && password === storedPassword;
    console.log('[Auth] Password validation result:', isValid);
    return isValid;
}

/**
 * 解析请求体JSON
 */
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (!body.trim()) {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * 生成简单的token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成token过期时间
 */
function getExpiryTime() {
    const now = Date.now();
    const expiry = 60 * 60 * 1000; // 1小时
    return now + expiry;
}

/**
 * 读取token存储文件
 */
async function readTokenStore() {
    try {
        if (existsSync(TOKEN_STORE_FILE)) {
            const content = await fs.readFile(TOKEN_STORE_FILE, 'utf8');
            return JSON.parse(content);
        } else {
            // 如果文件不存在，创建一个默认的token store
            await writeTokenStore({ tokens: {} });
            return { tokens: {} };
        }
    } catch (error) {
        console.error('[Token Store] Failed to read token store file:', error);
        return { tokens: {} };
    }
}

/**
 * 写入token存储文件
 */
async function writeTokenStore(tokenStore) {
    try {
        await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
    } catch (error) {
        console.error('[Token Store] Failed to write token store file:', error);
    }
}

/**
 * 验证简单token
 */
export async function verifyToken(token) {
    const tokenStore = await readTokenStore();
    const tokenInfo = tokenStore.tokens[token];
    if (!tokenInfo) {
        return null;
    }
    
    // 检查是否过期
    if (Date.now() > tokenInfo.expiryTime) {
        await deleteToken(token);
        return null;
    }
    
    return tokenInfo;
}

/**
 * 保存token到本地文件
 */
async function saveToken(token, tokenInfo) {
    const tokenStore = await readTokenStore();
    tokenStore.tokens[token] = tokenInfo;
    await writeTokenStore(tokenStore);
}

/**
 * 删除token
 */
async function deleteToken(token) {
    const tokenStore = await readTokenStore();
    if (tokenStore.tokens[token]) {
        delete tokenStore.tokens[token];
        await writeTokenStore(tokenStore);
    }
}

/**
 * 清理过期的token
 */
export async function cleanupExpiredTokens() {
    const tokenStore = await readTokenStore();
    const now = Date.now();
    let hasChanges = false;
    
    for (const token in tokenStore.tokens) {
        if (now > tokenStore.tokens[token].expiryTime) {
            delete tokenStore.tokens[token];
            hasChanges = true;
        }
    }
    
    if (hasChanges) {
        await writeTokenStore(tokenStore);
    }
}

/**
 * 检查token验证
 */
export async function checkAuth(req) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.substring(7);
    const tokenInfo = await verifyToken(token);
    
    return tokenInfo !== null;
}

/**
 * 处理登录请求
 */
export async function handleLoginRequest(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Only POST requests are supported' }));
        return true;
    }

    try {
        const requestData = await parseRequestBody(req);
        const { password } = requestData;
        
        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Password cannot be empty' }));
            return true;
        }

        const isValid = await validateCredentials(password);
        
        if (isValid) {
            // Generate simple token
            const token = generateToken();
            const expiryTime = getExpiryTime();
            
            // Store token info to local file
            await saveToken(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'Login successful',
                token,
                expiresIn: '1 hour'
            }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: 'Incorrect password, please try again'
            }));
        }
    } catch (error) {
        console.error('[Auth] Login processing error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || 'Server error'
        }));
    }
    return true;
}

// 定时清理过期token
setInterval(cleanupExpiredTokens, 5 * 60 * 1000); // 每5分钟清理一次