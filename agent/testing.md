# Testing specification

## 1. When to add or update tests

| Trigger | Requirement |
|---|---|
| Change worker handler logic | Must have corresponding behavior tests |
| Fix a bug | Add regression test, `it()` name reflects the bug scenario |
| Add API route or task type | Update `tests/contracts/` matrix |
| Change prompt suffix, referenceImages injection, DB write-back fields | Must have behavior assertions |

Do not claim feature complete without passing `npm run test:regression`.

---

## 2. Assertions must be behavior-level (check concrete values)

**Correct**:
```ts
// Assert DB wrote concrete field values
const updateData = prismaMock.globalCharacterAppearance.update.mock.calls.at(-1)?.[0].data
expect(updateData.description).toBe('AI_EXTRACTED_DESCRIPTION')

// Assert image-gen received correct params
const { prompt, options } = readGenerateCall(0)
expect(prompt).toContain(CHARACTER_PROMPT_SUFFIX)
expect(options.referenceImages).toEqual(['https://ref.example/a.png'])

// Assert return value
expect(result).toEqual({ success: true, count: 2 })
```

**Forbidden** (cannot be the only main assertion):
```ts
expect(fn).toHaveBeenCalled()        // Only shows "called", not "with what"
expect(fn).toHaveBeenCalledTimes(1)  // Count alone has no business meaning
```

---

## 3. Mock rules

**Must mock**:
- `prisma` (all DB operations)
- LLM / chatCompletionWithVision / generateImage
- COS / uploadToCOS / getSignedUrl
- External HTTP (fetchWithTimeoutAndRetry etc.)

**Do not mock**:
- The business logic under test
- Project constants (e.g. `CHARACTER_PROMPT_SUFFIX`), import and use directly

**No "self-answering"**:
```ts
// Wrong: mock returns X, assert X, no business logic in between
mockLLM.mockReturnValue('result')
expect(await mockLLM()).toBe('result')  // Useless test

// Right: mock AI returns X, assert business code wrote X to DB
llmMock.getCompletionContent.mockReturnValue('tall woman')
await handleTask(job)
expect(prismaMock.update.mock.calls.at(-1)[0].data.description).toBe('tall woman')
```

---

## 4. Test data rules

- **Fields that affect branches** must have separate `it()` cases, e.g.:
  - One case for "has extraImageUrls", one for "no extraImageUrls"
  - One for `isBackgroundJob: true`, one for `false`
- **Pure pass-through fields** (`taskId`, `userId`, etc.) can use placeholders like `'task-1'`
- **Each `it()` name format**: `[condition] -> [expected result]`

**Naming examples**:
```
Has reference image -> AI result written to description
No reference image -> No AI, description unchanged
AI call fails -> Main flow succeeds, description not polluted
Missing required param -> Throw error including field name
Batch confirm 2 characters -> Process each, count returns 2
```

---

## 5. Test file structure

```ts
// 1. vi.hoisted for all mocks (before any import)
const prismaMock = vi.hoisted(() => ({ ... }))
const llmMock = vi.hoisted(() => ({ ... }))

// 2. vi.mock registration (before import)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)

// 3. Import real business code (after mocks)
import { handleXxxTask } from '@/lib/workers/handlers/xxx'

// 4. describe + beforeEach reset mocks
describe('worker xxx behavior', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('[condition] -> [result]', async () => {
    // Setup: override mocks for this scenario
    // Build: buildJob(payload, taskType)
    // Run: await handleXxxTask(job)
    // Assert: check concrete values
  })
})
```

---

## 6. Run commands

| Scenario | Command |
|---|---|
| Changed worker logic | `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker` |
| Changed a specific file | `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker/xxx.test.ts` |
| Changed API routes | `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/integration/api` |
| Changed helpers / constants | `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/helpers` |
| Full check before commit | `npm run test:regression` |

---

## 7. Directory overview

| Directory | Purpose |
|---|---|
| `tests/unit/worker/` | Worker handler behavior (main regression) |
| `tests/unit/helpers/` | Pure / helper function tests |
| `tests/unit/optimistic/` | Frontend state hook behavior |
| `tests/integration/api/contract/` | API route contract (401/400/200 + payload) |
| `tests/integration/chain/` | queue → worker → result full chain |
| `tests/contracts/` | Matrix and guards (route/tasktype/requirements) |
| `tests/helpers/fakes/` | Shared mocks (llm, media, providers) |

---

## 8. Verify tests are not false greens

After writing tests:

1. Temporarily comment out the business logic you just tested; tests should go red.
2. Restore the logic; tests should go green.
3. If they stay green after commenting, assertions are not covering the real code path.
