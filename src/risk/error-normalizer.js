import { BAN_MARKERS, RISK_SIGNAL, RISK_STATUS_REASON, SUSPENSION_MARKERS } from './constants.js';

const RETRYABLE_NETWORK_ERRORS = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPIPE',
    'EAI_AGAIN',
    'ECONNABORTED',
    'ESOCKETTIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT'
];

function pickStatusCode(error) {
    const status = error?.response?.status ?? error?.statusCode ?? error?.status ?? error?.code;
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : null;
}

function collectErrorText(error) {
    const parts = [];

    if (typeof error?.message === 'string') {
        parts.push(error.message);
    }

    const responseData = error?.response?.data;
    if (typeof responseData === 'string') {
        parts.push(responseData);
    } else if (responseData && typeof responseData === 'object') {
        if (typeof responseData.error === 'string') {
            parts.push(responseData.error);
        }
        if (typeof responseData.message === 'string') {
            parts.push(responseData.message);
        }
        if (responseData.error && typeof responseData.error === 'object' && typeof responseData.error.message === 'string') {
            parts.push(responseData.error.message);
        }
    }

    return parts.join(' | ').toLowerCase();
}

function isRetryableNetworkError(error, text) {
    const errorCode = typeof error?.code === 'string' ? error.code : '';
    if (RETRYABLE_NETWORK_ERRORS.includes(errorCode)) {
        return true;
    }

    return RETRYABLE_NETWORK_ERRORS.some((marker) => text.includes(marker.toLowerCase()));
}

export function normalizeSignalFromError(error, context = {}) {
    if (!error) {
        return {
            signalType: RISK_SIGNAL.UNKNOWN,
            reasonCode: RISK_STATUS_REASON.UNKNOWN,
            statusCode: null,
            rawMessage: null
        };
    }

    if (error?.signalType && Object.values(RISK_SIGNAL).includes(error.signalType)) {
        return {
            signalType: error.signalType,
            reasonCode: RISK_STATUS_REASON.PROVIDER_SIGNAL,
            statusCode: pickStatusCode(error),
            rawMessage: error.message || null
        };
    }

    const statusCode = pickStatusCode(error);
    const rawMessage = typeof error?.message === 'string' ? error.message : null;
    const normalizedText = collectErrorText(error);

    if (BAN_MARKERS.some((marker) => normalizedText.includes(marker.toLowerCase()))) {
        return {
            signalType: RISK_SIGNAL.BANNED,
            reasonCode: RISK_STATUS_REASON.PROVIDER_SIGNAL,
            statusCode,
            rawMessage
        };
    }

    if (SUSPENSION_MARKERS.some((marker) => normalizedText.includes(marker.toLowerCase()))) {
        return {
            signalType: RISK_SIGNAL.SUSPENDED,
            reasonCode: statusCode === 423 ? RISK_STATUS_REASON.HTTP_423 : RISK_STATUS_REASON.HTTP_403,
            statusCode,
            rawMessage
        };
    }

    if (isRetryableNetworkError(error, normalizedText)) {
        return {
            signalType: RISK_SIGNAL.NETWORK_TRANSIENT,
            reasonCode: RISK_STATUS_REASON.NETWORK_ERROR,
            statusCode,
            rawMessage
        };
    }

    if (statusCode === 401) {
        return {
            signalType: RISK_SIGNAL.AUTH_INVALID,
            reasonCode: RISK_STATUS_REASON.HTTP_401,
            statusCode,
            rawMessage
        };
    }

    if (statusCode === 402) {
        return {
            signalType: RISK_SIGNAL.QUOTA_EXCEEDED,
            reasonCode: RISK_STATUS_REASON.HTTP_402,
            statusCode,
            rawMessage
        };
    }

    if (statusCode === 429) {
        return {
            signalType: RISK_SIGNAL.RATE_LIMITED,
            reasonCode: RISK_STATUS_REASON.HTTP_429,
            statusCode,
            rawMessage
        };
    }

    if (statusCode === 403) {
        return {
            signalType: RISK_SIGNAL.AUTH_INVALID,
            reasonCode: RISK_STATUS_REASON.HTTP_403,
            statusCode,
            rawMessage
        };
    }

    if (statusCode === 423) {
        return {
            signalType: RISK_SIGNAL.SUSPENDED,
            reasonCode: RISK_STATUS_REASON.HTTP_423,
            statusCode,
            rawMessage
        };
    }

    if (statusCode >= 500 && statusCode < 600) {
        return {
            signalType: RISK_SIGNAL.NETWORK_TRANSIENT,
            reasonCode: RISK_STATUS_REASON.HTTP_5XX,
            statusCode,
            rawMessage
        };
    }

    if (context?.signalType && Object.values(RISK_SIGNAL).includes(context.signalType)) {
        return {
            signalType: context.signalType,
            reasonCode: RISK_STATUS_REASON.PROVIDER_SIGNAL,
            statusCode,
            rawMessage
        };
    }

    return {
        signalType: RISK_SIGNAL.UNKNOWN,
        reasonCode: RISK_STATUS_REASON.UNKNOWN,
        statusCode,
        rawMessage
    };
}
