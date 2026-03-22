import logger from '../src/utils/logger.js';
import { CodexApiService } from '../src/providers/openai/codex-core.js';

const captured = [];
const originalWarn = logger.warn.bind(logger);

logger.warn = (...args) => {
  captured.push(args.map((arg) => String(arg)).join(' '));
};

try {
  const service = new CodexApiService({ CODEX_CACHE_DEBUG_LOG: true });
  const requestBody = {
    model: 'gpt-5.4-mini',
    metadata: {
      session_id: 'discord:channel:cache-debug',
    },
  };

  await service.prepareRequestBody('gpt-5.4-mini', requestBody, false);
  await service.prepareRequestBody('gpt-5.4-mini', requestBody, false);

  const checks = [
    captured.length === 2,
    captured[0]?.includes('[Codex CacheDebug]'),
    captured[0]?.includes('sessionId=discord:channel:cache-debug'),
    captured[0]?.includes('cacheKey=discord:channel:cache-debug'),
    captured[0]?.includes('status=miss'),
    captured[1]?.includes('status=hit'),
  ];

  if (checks.every(Boolean)) {
    console.log('PASS');
    process.exit(0);
  }

  console.error('FAIL');
  console.error(JSON.stringify({ captured }, null, 2));
  process.exit(1);
} finally {
  logger.warn = originalWarn;
}
