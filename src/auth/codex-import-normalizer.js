function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseJwtPayload(token) {
    const tokenValue = cleanString(token);
    if (!tokenValue) return null;

    const parts = tokenValue.split('.');
    if (parts.length !== 3) return null;

    try {
        const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

function getAuthClaims(claims) {
    return claims?.['https://api.openai.com/auth'] || {};
}

function getProfileClaims(claims) {
    return claims?.['https://api.openai.com/profile'] || {};
}

function expiryFromValues({ expired, expiresAt, expires_at, expires_in, claims }) {
    const explicit = expired || expiresAt;
    if (explicit) {
        const date = new Date(explicit);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }

    if (expires_at) {
        const timestamp = Number(expires_at);
        if (Number.isFinite(timestamp)) {
            const milliseconds = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
            const date = new Date(milliseconds);
            if (!Number.isNaN(date.getTime())) return date.toISOString();
        }
    }

    if (expires_in) {
        const seconds = Number(expires_in);
        if (Number.isFinite(seconds) && seconds > 0) {
            return new Date(Date.now() + seconds * 1000).toISOString();
        }
    }

    if (claims?.exp) {
        const exp = Number(claims.exp);
        if (Number.isFinite(exp)) {
            return new Date(exp * 1000).toISOString();
        }
    }

    return new Date(Date.now() + 3600 * 1000).toISOString();
}

function makeFallbackEmail(accountId, index) {
    if (accountId) return `codex-${accountId}`;
    return `codex-import-${index}`;
}

function normalizeCredential(raw, source, index, exportedAt = null) {
    if (!isPlainObject(raw)) {
        return {
            error: '凭据必须是 JSON 对象',
            source,
            index
        };
    }

    const nestedCredentials = isPlainObject(raw.credentials) ? raw.credentials : {};
    const nestedExtra = isPlainObject(raw.extra) ? raw.extra : {};
    const data = { ...raw, ...nestedCredentials };

    const accessToken = cleanString(data.access_token);
    if (!accessToken) {
        return {
            error: '缺少 access_token',
            source,
            index,
            email: cleanString(raw.email || raw.name || nestedExtra.email)
        };
    }

    const idToken = cleanString(data.id_token);
    const accessClaims = parseJwtPayload(accessToken);
    const idClaims = parseJwtPayload(idToken);
    const claims = idClaims || accessClaims || {};
    const authClaims = getAuthClaims(claims);
    const profileClaims = getProfileClaims(claims);

    const accountId = cleanString(
        data.account_id ||
        data.chatgpt_account_id ||
        authClaims.chatgpt_account_id ||
        claims.sub
    );
    const email = cleanString(
        raw.email ||
        nestedExtra.email ||
        raw.name ||
        data.email ||
        profileClaims.email ||
        claims.email
    ) || makeFallbackEmail(accountId, index);

    if (!accountId) {
        return {
            error: '无法获取 account_id 或 chatgpt_account_id',
            source,
            index,
            email
        };
    }

    const refreshToken = cleanString(data.refresh_token);
    const expired = expiryFromValues({
        expired: data.expired,
        expiresAt: data.expiresAt,
        expires_at: data.expires_at,
        expires_in: data.expires_in,
        claims
    });

    return {
        source,
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
        chatgpt_account_id: accountId,
        email,
        name: email,
        type: 'codex',
        last_refresh: cleanString(data.last_refresh || exportedAt) || new Date().toISOString(),
        expired,
        access_token_only: !refreshToken
    };
}

export function normalizeCpaCodexCredentials(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    return items.map((item, index) => normalizeCredential(item, 'cpa', index + 1));
}

export function normalizeSub2ApiCodexCredentials(payload) {
    let accounts;
    let exportedAt = null;

    if (Array.isArray(payload)) {
        accounts = payload;
    } else if (isPlainObject(payload) && Array.isArray(payload.accounts)) {
        accounts = payload.accounts;
        exportedAt = payload.exported_at || null;
    } else if (isPlainObject(payload) && isPlainObject(payload.credentials)) {
        accounts = [payload];
    } else {
        throw new Error('sub2api 数据必须是完整导出对象、账号数组或单个账号对象');
    }

    const results = [];

    accounts.forEach((account, index) => {
        if (!isPlainObject(account)) {
            results.push({
                error: '账号条目必须是 JSON 对象',
                source: 'sub2api',
                index: index + 1
            });
            return;
        }

        if (account.platform && account.platform !== 'openai') {
            results.push({
                skipped: true,
                source: 'sub2api',
                index: index + 1,
                email: cleanString(account.extra?.email || account.name),
                reason: `跳过非 openai 平台账号: ${account.platform}`
            });
            return;
        }

        results.push(normalizeCredential(account, 'sub2api', index + 1, exportedAt));
    });

    return results;
}

export function normalizeCodexExternalCredentials(source, payload) {
    if (source === 'cpa') {
        return normalizeCpaCodexCredentials(payload);
    }

    if (source === 'sub2api') {
        return normalizeSub2ApiCodexCredentials(payload);
    }

    throw new Error(`Unsupported Codex import source: ${source}`);
}
