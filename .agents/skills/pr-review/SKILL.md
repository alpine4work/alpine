---
name: pr-review
description: |
    Write a review.md with a detailed breakdown of the changes in this PR. Compares against the
    Graphite stacked PR parent branch. Checks for bugs, performance issues, and code style problems
    using rules derived from historical review patterns.
---

# PR Review

Review the current branch's diff against its Graphite parent branch, applying the rules below. Write
findings to `review.md` in the project root.

## Step 1: Read code style guide

Read `admin/docs/code_style.md` to refresh on the project's code style conventions.

## Step 2: Determine the parent branch

Use Graphite to find the parent branch:

```bash
gt log short
```

Identify the current branch and its parent. The parent is the branch directly below the current one
in the stack. If not using Graphite, fall back to:

```bash
git merge-base HEAD main
```

## Step 3: Get the diff

```bash
git diff <parent-branch>...HEAD
```

Read through the entire diff carefully. For each changed file, also read the full file to understand
surrounding context.

## Step 4: Scan for common utilities

Before writing findings, scan the codebase for existing utilities that the diff could use:

```bash
# Check shared helpers
ls shared/helpers/
# Check for existing patterns the diff might duplicate
```

Key utility locations to check:
- `shared/helpers/control/assert.ts` -- `assert()`, `assertExists()`
- `shared/helpers/control/result.ts` -- Result union types
- `shared/helpers/control/exhaustive.ts` -- `exhaustive()` for switch defaults
- `shared/helpers/async/run_all_promises.ts` -- `runAllPromises()`
- `shared/helpers/object/has_own_property.ts` -- `hasOwnProperty()`
- `shared/helpers/cast.ts` -- `cast<T>()` safe casting

Search for any utility that could replace hand-rolled logic in the diff.

## Step 5: Apply review rules and write review.md

Go through the diff applying every rule below. For each finding, determine the category (Bugs,
Performance, or Code Style) and write it as a `### [ ]` entry.

### Output format

```markdown
# General feedback

{High-level summary: what the PR does, overall impressions, and any architectural concerns.}

# Comments

## Bugs

### [ ] {Finding title}
`path/to/file.ts:42`

\`\`\`ts
// surrounding context
//////////////
//
// Review comment explaining the issue
//
//////////////
const problematicLine = something();
// more context
\`\`\`

## Performance issues

### [ ] {Finding title}
`path/to/file.ts:88`

\`\`\`ts
// context
//////////////
//
// Explanation of the performance concern
//
//////////////
await sequentialCall();
\`\`\`

## Code style

### [ ] {Finding title}
`path/to/file.ts:15`

\`\`\`ts
// context
//////////////
//
// Style issue explanation
//
//////////////
const SCREAMING_CASE = "bad";
\`\`\`
```

If a category has no findings, include the heading with "No issues found." underneath.

---

# Review Rules

These rules are derived from review patterns across the entire PR history of this codebase.
Apply them to every diff you review.

## Bugs

### B1: Missing authorization checks
Every exported function in `_table.ts` and `_actions.ts` files must verify the caller has
appropriate access. Check for `authorizeSpaceAccess()`, `authorizeOwnAccountAccess()`,
`authorizeOwnSpaceAccountAccess()`, `authorizeNotBotSpaceAccount()`, etc. Missing authorization is a
security vulnerability. Don't export dangerous internal functions without a `dangerously` prefix.

### B2: Wrong error type for the situation
- `InternalError` (500) = "our fault", triggers alerts. Never use for expected failures.
- `FailedPreconditionError` (400) = operation impossible for everyone (e.g., can't remove an owner).
- `InvalidArgumentError` (400) = bad input from the caller.
- `PermissionDeniedError` (403) = caller lacks permission (implies someone else might have it).
Include a `displayMessage` for user-facing errors. Never put user data in error `message` (it goes
to Honeycomb); use `displayMessage` instead.

### B3: Unsafe type assertions (`as T`, `x!`)
`as T` is unsound -- it suppresses type errors silently. Use `cast<T>(x)` from
`shared/helpers/cast.ts` for safe casts, or restructure code so TypeScript narrows naturally. Never
use `as never` to silence `exhaustive()` checks. Use `assertExists(x)` instead of `x!`.

### B4: Race conditions in concurrent state updates
Watch for boolean flags like `isLoading` that get set to `false` when one of multiple concurrent
operations finishes while others are still in progress. Watch for retry loops that reference stale
data fetched before the loop. Watch for DynamoDB operations that should be wrapped in
`retryTransaction()`.

### B5: Mutating React state directly
React state must be treated as immutable. Don't call mutating methods (`.delete()`, `.push()`,
`.set()`) on objects that are React state. Create new instances instead.

### B6: Referential equality vs value equality
Don't use `===` to compare objects (especially `Date` objects). Compare `.getTime()` for dates,
`.pos` for ProseMirror positions, etc. `===` on objects is referential, not structural.

### B7: Don't use try/catch for control flow
If code catches specific error types/messages to branch logic, it's fragile. If someone wraps the
call in `runAllPromises()` or changes the error, the catch silently breaks. Return union objects
with `{ok: true, ...} | {ok: false, reason: "..."}` instead. Never use blanket catches that
swallow internal errors.

### B8: No mutations on idempotent HTTP GET requests
Remix loaders and GET API endpoints must be side-effect-free. Browsers, crawlers, and prefetchers
can call GET requests at any time. Move mutations to actions (POST/PUT/DELETE).

### B9: SSR/client hydration mismatches
Don't use `generateId()`, `Math.random()`, or `new Date()` in `useMemo()` or during render. These
produce different values on server vs client, causing hydration errors.

### B10: Validate user input -- don't assert on it
`assert()` crashes the app. For user-controlled data (clipboard, URL params, parsed HTML, JSON),
use graceful handling. `JSON.parse()` on user data needs a try/catch for syntax errors. Check
`typeof` on parsed HTML attributes.

### B11: Stale data in retry loops
If a `retryTransaction()` loop references an item fetched before the loop, the retry will use stale
`updateLockVersion` and always fail. Re-fetch inside the loop.

### B12: Falsy checks on valid values
`if (!value)` treats `0`, `""`, and `false` as missing. Use `value !== undefined && value !== null`
or `value == null` when `0`/`""`/`false` are valid.

### B13: Constructor.name breaks in production
Code minification renames classes. Use `instanceof` instead of `constructor.name` checks.

### B14: Ignoring return values
If a function returns a boolean (like a membership check) and you call it without using the result,
it's a wasted database request and likely a missing guard.

### B15: Webhook/event handlers must be idempotent
External services (Stripe, etc.) retry webhook deliveries. Handlers must be safe to call multiple
times with the same event. Add deduplication.

### B16: Always use `runAllPromises()` instead of `Promise.all()`
`Promise.all()` returns on first rejection, losing other errors. `runAllPromises()` waits for all
promises and creates an `AggregateError`.

### B17: Don't re-fetch data you already have
After a write/transaction, don't re-read the same data. It's subject to eventual consistency lag and
wastes reads. Use the data you already have in memory.

### B18: Nested transaction/retry loops
Don't call a function that uses `retryTransaction()` from within another `retryTransaction()`. Don't
call `updateItem()` (which loads internally) when you already loaded the item.

## Performance

### P1: Parallelize independent async operations
Sequential `await` calls on independent operations must use `runAllPromises()`. If two fetches each
take 50ms, sequential = 100ms, parallel = 50ms. Look for `await` calls that don't depend on each
other.

### P2: Use `Set` instead of `Array` for membership checks
`Array.includes()` is O(n). `Set.has()` is O(1). Especially critical inside `.filter()` or `.map()`
loops where it becomes O(n^2).

### P3: Avoid O(n^2) patterns
- `{...object, key: value}` in a loop copies the entire object each iteration.
- `array.push(...otherArray)` has argument count limits (~65,535) and is O(n).
- `Array.includes()` inside loops.
Use mutation, `Map`, or `Set` instead.

### P4: Avoid unnecessary database reads
Don't load data you never use. Don't fetch data separately that could be included in an adjacent
query. Every DynamoDB read costs money (RCUs) and adds latency. Use `getItem()` (which is batched)
over `getPartialItem()` (which is not).

### P5: `useMemo()` for expensive computations in React
Derived values computed inline (base64 encoding, sorting, filtering) without memoization run on
every re-render. Use `useMemo()`. For object references that are expensive to create, consider
`WeakMap` caching.

### P6: Early return instead of flag-based control flow
Instead of `shouldSend = false` followed by continued data loading, return early. Don't load data
you won't use.

### P7: `useLayoutEffect` for visual updates
`useEffect` runs after the browser paints, causing flicker. `useLayoutEffect` runs before paint.
Use it for visual state updates the user sees immediately.

### P8: Hoist expensive computations out of hot paths
Sorting, constructing objects, or regex compilation that runs on every function call but only needs
to run once should be hoisted to module scope or wrapped in `Lazy`.

### P9: Avoid strong consistency when eventual is sufficient
Strong consistency reads in DynamoDB are more expensive and slower. Only use them when stale data
would cause correctness issues (e.g., reads after writes in event handlers).

### P10: Don't load data you won't render
Don't fetch data for UI elements that won't be shown in the current layout (e.g., don't load
comments on mobile if they're not rendered).

### P11: Avoid duplicate database queries
Don't call the same authorization or data-fetching function multiple times in the same request.
Share a promise instead.

### P12: Protect useEffect network requests with a ref
React strict mode can cause effects to fire twice. Guard network requests in `useEffect` with a ref
to prevent duplicate requests.

### P13: Use DynamoDB query() for adjacent items
Multiple `getItem()` calls for physically adjacent items (consecutive sort keys) should be a single
`query()`. It's faster and cheaper (potentially half the RCUs).

### P14: Use DynamoDB TTL instead of explicit deletes
For transient items, set an `expirationTime` and let DynamoDB delete them for free instead of
spending WCUs on explicit deletes.

### P15: Avoid pinning different versions of the same dependency
Different versions of packages in the same family (e.g., `@aws-sdk/*`) cause the entire dependency
tree to be duplicated in the bundle. Pin the same version as existing packages.

## Code Style

### S1: File names must match primary export
No generic names like `*_constants.ts`, `*_types.ts`, `*_utils.ts`. One helper per file, named
after the export. If the file exports `createAvatarResponseSchema`, name it
`create_avatar_response_schema.ts`.

### S2: Exported names must be globally unique
Generic names like `get`, `context`, `Results`, `Config` pollute auto-import suggestions. Add
namespace prefixes: `AgentLinkPaginationType`, `contentTableProsemirrorNodeSpec`.

### S3: Prefer function declarations at module scope
Use `function f() {}` instead of `const f = () => {}` at module scope. Function declarations are
hoisted, have better stack traces, and are the project convention.

### S4: Use `exhaustive()` in switch default cases
Switch on discriminated unions/enums must use `default: throw exhaustive(value)`. This provides
compile-time verification that every case is handled. Wrap multi-line case bodies in braces to
prevent variable leaking.

### S5: Prefer early returns over nested conditionals
Put the smallest branch first and return early. Reduces indentation and makes the happy path more
prominent.

### S6: Use `??` instead of `||` for default values
`||` treats `false`, `0`, and `""` as falsy. `??` only defaults for `null`/`undefined`.

### S7: JSDoc for exports, inline comments for implementation
`/** */` comments show in IDE hover tooltips -- use for exported functions/types. `//` comments for
implementation details. Comments wrap at 80 chars (not including indentation), formatted as
markdown. Don't write redundant comments that restate the code.

### S8: Named arguments at 4+ parameters
Use object parameters for functions with 4+ args, any boolean parameters, or 2+ parameters of the
same type. `f({a: 1, b: true})` is clearer than `f(1, true)`.

### S9: Use discriminated unions for mutually exclusive state
Don't use multiple `useState` booleans for states that can't coexist. Use
`useState<{type: "A", data} | {type: "B", data} | null>(null)`.

### S10: Direct coding style -- assert, don't silently return
Use `assert()` and `assertExists()` when values should always exist. Don't return `null` silently
for impossible cases. Make impossible cases actually impossible.

### S11: Avoid `_utils.ts` barrel files
One helper per file. Split utility files by function. Each file named after its single export.

### S12: Don't use optional chaining on known non-null values
`spaceAccountItem?.role` when `spaceAccountItem` is known non-null signals to readers that it might
be null, creating confusion. Use `spaceAccountItem.role`.

### S13: Context is always the first argument
Never put `context` inside an options object. It's always the standalone first parameter.

### S14: Prefer `readonly` by default
DynamoDB items, shared data structures, and types should use `readonly` properties. Don't allow
consumers to mutate shared state.

### S15: camelCase for constants, not SCREAMING_SNAKE_CASE
No meaningful runtime difference in JavaScript. camelCase is consistent and less noisy.

### S16: Prefer `for` loops over `reduce` for inline accumulation
`reduce` has cognitive overhead. For-loops are more readable for imperative accumulation.

### S17: Don't duplicate logic the server owns
Don't re-implement server-side business rules on the client. Trust the backend's response.

### S18: Use `Schema.deserialize()` for JSON data
Don't use raw `JSON.parse()` without schema validation. `JSON.parse` doesn't restore complex types.
`instanceof` never works on parsed JSON objects.

### S19: Use `hasOwnProperty()` helper instead of `in` operator
`in` searches the prototype chain. `"toString" in obj` returns `true` for any object.

### S20: Sentence case for product copy, curly quotes for user-facing strings
Use sentence case ("Quiet button" not "Quiet Button"). Use curly/typographic quotes in user-facing
strings (`\u2019` for apostrophe).

### S21: No hardcoded colors or pixel values
Use `colorSchemeVars` for colors (they flip in dark/light mode). Use `spacing['1']` or rem values
instead of raw pixels.

### S22: Delete dead/commented-out code
Don't commit commented-out code. Version control preserves history. Delete unused imports and
variables.

### S23: Prefer flat directory structures
Don't create subdirectories like `tools/`, `types/` when files could live flat in the parent.
Developers inconsistently maintain directory conventions.

### S24: Avoid abbreviations in names
Prefer "options" over "props", full words over acronyms. Use descriptive generic type names
(`Secrets` over `T`).

### S25: Name maps as "x by y"
`titleBySettingsRoute` makes iteration obvious: `for (const [settingsRoute, title] of ...)`.

### S26: String enums over boolean/null tri-states
`"Accepted" | "Rejected" | "Pending"` is clearer than `true | false | null`.

### S27: Avoid redundant wrapper functions
Don't create `generateAvatarId()` that only calls `generateChronologicalId<AvatarId>()`. Call the
underlying function directly.

### S28: Function names start with verbs
Use `getConversationState()` not `conversationState()`. Verbs differentiate functions from
variables.

### S29: Mark dangerous functions with `dangerously` prefix
Functions that bypass authorization or skip validation should be prefixed with `dangerously` to
discourage careless usage.

### S30: Avoid re-creating existing utilities
Before writing a new helper, search the codebase for existing functions that do the same thing.
Check `shared/helpers/` thoroughly.

### S31: Use NOCOMMIT for WIP code
Add `NOCOMMIT` to placeholder code. An ESLint rule prevents committing files containing it.

### S32: Every interactive element needs keyboard accessibility
Interactive elements must have `tabIndex`, focus rings, and keyboard event handlers. Avoid
hover-only states (touch devices can't hover).

### S33: Don't disable lint rules at file level
Use `// eslint-disable-next-line` for specific lines, not `/* eslint-disable */` at file level.
File-level disabling lets future violations slip through.

### S34: Add negative assertions before actions in integration tests
Assert initial state before performing an action: `expect(...).not.toBeVisible()` then click, then
`expect(...).toBeVisible()`. Without this, the expected state might have already been present.

### S35: Evaluate third-party library quality before adding dependencies
Check download counts, last publish date, and code size. If a library is small and unmaintained,
consider forking or inlining.

### S36: Related database writes should be transactional
Multiple related mutations (e.g., updating a plan AND recording a purchase) should be in a single
transaction. Partial failures leave data inconsistent.

### S37: Don't expose `className` props on design components
`className` lets callers break carefully designed CSS layout and design rules.

### S38: Use consistent terminology
Use "account" not "user". Use established terms from the codebase. Don't introduce synonyms for
existing concepts.
