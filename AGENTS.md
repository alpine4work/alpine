# AGENTS.md

This is `cyberworlds`, the codebase for Alpine. Alpine is a productivity suite containing:

- Rich text collaborative documents (similar to Google Docs)
- Collaborative task tracker (similar to Jira)
- Chat (either person-to-person or groups, similar to Slack)
- Forum for asynchronous communication
- Algorithmic feed (similar to a Facebook feed but for work)
- Unified inbox for notifications
- Intelligent search using heuristics like affinity
- AI agents for working with your data

## Directory structure

- `shared`: Code shared across the client and the server.
- `client`: Code that runs on a user's device, typically in a web browser.
- `server`: Code that runs in a cloud environment, typically in AWS or Cloudflare.
- `app`: Remix web app that mostly declares routes and imports code from `client` + `server` to do
  all the work.
- `admin`: Internal developer tools, build system configuration, deployment scripts, and more. This
  code doesn’t run in production.

Within these directories we have individual Bazel packages, typically organized by feature area. For
example `shared/documents`, `server/documents`, and `client/documents`. Bazel packages are our unit
of organization, they are folders with a `BUILD` file in them and you can think of them as a Node.js
package with a `package.json` file.

## Stack

- Build system: Bazel
- Programming language: TypeScript
- Frontend: React (framework is Remix with Vite)
- Backend: Node.js
- Databases: DynamoDB, OpenSearch, Cloudflare R2
- Hosting: AWS EC2 instances on ECS (for most things), Cloudflare Workers (for edge compute), and
  Cloudflare Durable Objects (for some realtime)
- Package manager: Bazel, pnpm
- Tests: Jest (unit tests), Playwright (integration tests)
- Rich text editor: ProseMirror

## Tips

- Everything in Alpine is built with Bazel.

- Most Bazel packages use the `ts_project()` macro (maintained by us). It automatically sets up
  Bazel tests for type checking (e.g. `//shared/helpers:helpers_typecheck_test`), linting (e.g.
  `//shared/helpers:helpers_lint_test`), formatting (e.g. `//shared/helpers:helpers_format_test`),
  and Jest unit tests (one for each `*.test.ts` file, e.g. `shared/helpers/array/queue.test.ts`
  creates the test `//shared/helpers:array/queue_test`).

- To run all tests in a single package use `bazel test //shared/helpers/...`.

- `dev check` runs type check and lint tests for code affected by changes in the current branch.
  Generally you should always run this before finishing a turn to make sure your changes are correct.

- `dev test` runs Jest unit tests for code affected by changes in the current branch. This command
  is expensive, only run it if the user has explicitly asked you to run `dev test`. Prefer running
  individual tests with `bazel test [targets...]` or `dev test [paths...]` (where paths end in
  `.test.ts`, running `dev test shared/helpers/array/queue.test.ts` will only run that one test file
  and is much faster).

- `dev format` runs Prettier on all changed files in the current branch.

- Instead of running type checking for a single package (e.g.
  `bazel test //shared/helpers:helpers_typecheck_test`) you should run `dev check`. `dev check` will
  make sure any code that depends on your changes is also type checked.

- Prefer `bazel test *_lint_test` or `dev check` to running ESLint directly (e.g. `pnpm eslint`).
  The Bazel lint tests are configured with the correct plugins and settings.

- Never run Prettier directly. Use `dev format` to format files, or `bazel test *_format_test` if
  you just want to check that files are formatted correctly.

- Files in `internal` directories may only be imported by the parent directory. For example, files
  in `server/spaces/internal` may only be imported by files in `server/spaces`. You can import
  `server/spaces/internal` files from `server/spaces/create`. However, you can’t import files from
  `server/spaces/create/internal` from `server/spaces`, only `server/spaces/create`.

- When you need to use something from an `internal` directory outside its allowed scope, move it out
  of `internal/` into the parent directory instead of re-exporting it.

- `cyberworlds/no-commit-blockers` failures mark issues with code in the current branch to fix
  before merging. Leave these comments alone unless the user explicitly asks you to remove one.

## Code style

The full code style ruleset can be found in `admin/docs/code_style.md`, if needed.

### General

- Always use ES Module absolute imports starting with `~/` and ending with the file extension `.js`.
- Our person type is called "account" instead of "user".
- Don’t use `SCREAMING_SNAKE_CASE` for constant names, instead use `camelCase`.
- Use direct coding style: functions should read naturally, assertions are preferred to null checks
  (see `shared/helpers/control/assert.ts`).
- Don’t use try/catch for control flow. If your code needs to handle an error case return a union
  object with "ok" and "not ok" variants (e.g. `shared/helpers/control/result.ts`).
- Prefer named arguments after 4 parameters (e.g. `f({a: 1, b: 2})` instead of `f(1, 2)`).

### Naming

- File names should be `snake_case` and should follow the name of their primary export.
- File names should be globally unique across the entire codebase. Prefix with namespace if needed.
- Avoid default exports, prefer named exports.
- Exported names should be globally unique across the entire codebase. Add namespaces if needed.
- Prefer long, descriptive names over short, ambiguous names. Include context like `fooForBar` or
  `fooWithBar`.
- Type names should follow the pattern `{namespace}{subClass}{superClass}{member}`. For example, a
  type representing text styles in our rich text data might be named `ContentTextElementMark`
  (namespace: `Content`, sub-class: `Text`, super-class: `Element`, member: `Mark`, other related
  type names: `ContentElement`, `ContentTextElement`)
- Variable names should mirror type names. Start with type name, convert to camelCase, remove
  namespace if local.

### Comments

- Format comments as markdown.
- JSDoc comments (`/** ... */`, without tags like `@params`/`@returns`) for describing exports,
  inline comments (`// ...`) for implementation details.

### TypeScript

- Helper functions in individual modules. Avoid `_utils.ts` files. One helper per file.
- Avoid one-use helper functions. Only extract logic into a helper if it is very large and used at
  least twice, or small and used at least three times.
- For module scope functions prefer function declarations (`function f() {}`) to arrow functions
  (`const f = () => {}`).
- Avoid classes. Prefer discriminated unions and composition over inheritance.
- Avoid shared mutability. Local mutation within a function is ok, but don't mutate shared objects.
  Prefer immutable data structures.
- Always use `runAllPromises()` instead of `Promise.all()`.
- Prefer `switch`/`case` when checking values of enums or discriminated object unions instead of
  `if`/`else`, with `default: throw exhaustive(enumVariable)` to ensure exhaustiveness.

### Testing

- Write focused tests using the Arrange, Act, Assert pattern.
- Keep each test scoped to a single case so failures are easy to understand.
- Prioritize readable tests so reviewers can be confident the code is behaving as expected from a
  quick read of a test.
- Prefer asserting on specific error messages (e.g. `expect().toThrow("...")`) instead of error
  classes (e.g. `expect().toThrow(PermissionDeniedError)`) to ensure the correct error path is
  exercised.
