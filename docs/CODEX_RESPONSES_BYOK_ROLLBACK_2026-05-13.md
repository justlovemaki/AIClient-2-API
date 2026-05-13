# Codex Responses BYOK rollback note — 2026-05-13

This note covers the local branch `draft-codex-responses-compat-guards` after commit `2f0d5d0` (`fix: default Codex Responses canonical stream`).

## Scope

The change is source-only in this repository/fork. It was pushed to the fork branch and therefore updates the existing upstream PR for Codex Responses compatibility. It was not deployed to the live API panel/container by this commit.

Changed areas:

- `src/utils/common.js`
  - default `CODEX_RESPONSES_STREAM_MODE` changed from `raw` to `canonical`;
  - OpenAI Responses system prompt extraction added.
- `src/providers/openai/openai-responses-strategy.js`
  - fixes previously undefined `existingSystemText` in Responses system-prompt injection.
- `src/converters/strategies/OpenAIResponsesConverter.js`
  - normalizes direct Responses `tool_choice: { type: "function", name }` for OpenAI Chat and Claude conversion.
- Tests:
  - `tests/codex-responses-compat.test.js`
  - `tests/openai-responses-compat.test.js`

## Runtime rollback without reverting code

If the code is deployed and canonical mode causes regressions, restore the old stream behavior by explicitly setting:

```text
CODEX_RESPONSES_STREAM_MODE=raw
```

Then restart the AIClient2API process/container so the environment is reloaded.

## Git rollback

From this repository:

```powershell
Set-Location 'I:\Git\Upstream\AIClient2API'
```

Revert only the 2026-05-13 default-canonical patch:

```powershell
git revert 2f0d5d0
```

If this rollback note itself should also be reverted after it is committed, revert the rollback-note commit too.

## Local uncommitted rollback, if needed before committing

If the same changes are present only as local edits, restore modified tracked files and remove the added test:

```powershell
git restore src/converters/strategies/OpenAIResponsesConverter.js src/providers/openai/openai-responses-strategy.js src/utils/common.js tests/codex-responses-compat.test.js
Remove-Item 'tests/openai-responses-compat.test.js'
```

## Validation commands

Focused/non-integration validation used for this patch:

```powershell
npm test -- --runTestsByPath tests/codex-responses-compat.test.js tests/openai-responses-compat.test.js
npm test -- --testPathIgnorePatterns=api-integration.test.js
```

The full `npm test` includes `tests/api-integration.test.js`, which targets the upstream owner's hardcoded integration server `http://192.168.1.232:3000`; that address is not the local/live panel used in our environment.