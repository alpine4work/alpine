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

Files in `internal` directories may only be imported by the parent directory. For example, files in
`server/spaces/internal` may only be imported by files in `server/spaces`. You can import
`server/spaces/internal` files from `server/spaces/create`. However, you can’t import files from
`server/spaces/create/internal` from `server/spaces`, only `server/spaces/create`.

When you need to use a function from an `internal` directory outside its allowed scope, move the
function file out of `internal/` into the parent directory instead of re-exporting it. The filename
should match the function name (e.g. `myInternalFunction` moves to `my_internal_function.ts`).

Bazel packages also have `visibility` definitions that only allow certain Bazel packages to use them
as a dependency.

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

### Bazel crash course

Everything in Alpine is built with Bazel. It's important to understand how we use Bazel.

Everything in Bazel is referenced by a label. A label starts with `//` then path to a Bazel package
(a directory with a `BUILD`) file then a `:` with the label name. For example:

```
//shared/helpers:array/queue_test
```

`shared/helpers` is a Bazel package (you know because it has a `BUILD` file) which is why the `:` is
placed there.

If a Bazel label doesn’t have a `:` then the last directory name is the label name (e.g.
`//shared/helpers` is shorthand for `//shared/helpers:helpers`).

Most Bazel packages at Alpine use the `ts_project()` rule maintained by us. It automatically
collects the project’s source files and lets you declare dependencies (`deps`, you aren’t allowed to
have cyclic dependencies between Bazel packages). This rule sets up Bazel tests for type checking
(e.g. `//shared/helpers:helpers_typecheck_test`), linting (e.g.
`//shared/helpers:helpers_lint_test`), formatting (e.g. `//shared/helpers:helpers_format_test`), and
Jest unit tests.

When you use `ts_project()` it automatically creates a rule for every `*.test.ts` file in the
package (formatted as `*_test`). So for our previous example we have a file
`shared/helpers/array/queue.test.ts`. The `ts_project()` rule created a label with the name
`array/queue_test`. The label for the file `shared/id/id.test.ts` is `//shared/id:id_test` since
`shared/id` is the Bazel package.

You can run one or many Bazel tests like this:

```bash
bazel test [...labels]

# e.g.
bazel test //shared/helpers:array/queue_test //shared/helpers:helpers_lint_test //shared/id:id_test
```

You can run a single Bazel test and pass in options to the underlying Jest runner like this:

```bash
bazel run <label> -- [...options]

# e.g.
bazel run //shared/helpers:array/queue_test -- -t="..."
```

You can run all tests in a package like this:

```bash
bazel test //shared/helpers/...
```

We have some scripts available from the `dev` executable for running Bazel tests just on files that
changed in the current git branch:

```bash
dev check  # Runs type check and lint tests for packages affected by changes in the current branch
dev test   # Runs Jest unit tests and coverage for packages affected by changes in the current branch
dev format # Runs Prettier and on all changed files in the current branch
dev coverage <path-to-source> --changed-lines-only # Reports uncovered changed lines one by one
```

Instead of running type checking for a single package (e.g.
`bazel test //shared/helpers:helpers_typecheck_test`) you should run `dev check`. Because type
checking a single package with Bazel won’t check types for the _dependencies_ of the package which
might have been affected if you updated exports. Generally running `dev check` is much better than
individually running lint, type check, and formatting tests.

`dev test` generates coverage reports for the tests it just ran and writes them to
`admin/coverage/test`. It may print warnings of uncovered lines of changed files. If the warning is
truncated with `(X more range(s))` or you need exact line-by-line detail, run
`dev coverage <path-to-source> --changed-lines-only` for the affected source file. When running
`dev test` on an explicit adjacent test file, such as `foo.test.ts`, coverage warnings also include
changed lines in the matching source file, such as `foo.ts`. When coverage warnings identify
uncovered changed lines, check whether the branch already adds or updates unit tests for that
behavior. If it does, add the missing coverage to those tests. If it does not, tell the user the
changed lines should have unit test coverage and ask whether they want you to add it before creating
new tests or broadening the test scope.

Prefer `bazel test *_lint_test` or `dev check` to running ESLint directly (e.g. `pnpm eslint`). The
Bazel lint tests are configured with the correct plugins and settings.

Never run Prettier directly. Use `dev format` to format files, or `bazel test *_format_test` if you
just want to check that files are formatted correctly.

## Code style

The full code style ruleset can be found in `admin/docs/code_style.md`, if needed.

### General

- Always use ES Module absolute imports starting with `~/` and ending with the file extension `.js`.
- Our person type is called "account" instead of "user".
- Don’t use `SCREAMING_SNAKE_CASE` for constant names, instead use `camelCase`.
- Use direct coding style - Functions should read naturally; use assertions vs null checks (see
  `shared/helpers/control/assert.ts`); throw on not found vs returning null.
- Don’t use try/catch for control flow. If your code needs to handle an error case return a union
  object with "ok" and "not ok" variants (e.g. `shared/helpers/control/result.ts`).
- Prefer named arguments after 4 parameters (e.g. `f({a: 1, b: 2})` instead of `f(1, 2)`). Also for
  functions with 2 parameters of the same type or any boolean parameters.

### Naming

- File names should be `snake_case` and should follow the name of their primary export.
- File names should be globally unique. Prefix with namespace if needed.
- Avoid default exports, prefer named exports.
- Exported names should be globally unique. Add namespaces if needed.
- Prefer short function names for the most common case even if it's not the most "primitive" case.
  Add suffixes like `IfExists` for variants.
- Prefer long, descriptive names. Include context like `fooForBar` or `fooWithBar`.
- Recommended type naming convention: `{namespace}{subClass}{superClass}{member}`, for example: a
  type representing text styles in our rich text data might be named `ContentTextElementMark`
  (namespace: `Content`, sub-class: `Text`, super-class: `Element`, member: `Mark`, other related
  type names: `ContentElement`, `ContentTextElement`)
- Variable names should mirror type names. Start with type name, convert to camelCase, remove
  namespace if local.

### Comments

- Comments wrap at 80 chars not including indentation.
- Format comments as markdown.
- JSDoc comments (`/** ... */`) for describing exports so it shows up in TypeScript tooling, inline
  comments (`// ...`) for implementation details.

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

### Commit blockers

`cyberworlds/no-commit-blockers` lint failures are TODO markers for the developer to update
something, not build failures. Agents must not remove any `cyberworlds/no-commit-blockers` rule
failures without asking the user first. Permission for one removal applies only to that single
instance; every other `cyberworlds/no-commit-blockers` rule failure requires its own separate user
approval.

### Testing

- Avoid testing unrelated behavior. Each test should be testing only one thing.
- Aim for one `expect()` per test. Use `expect().toMatchObject()` and `expect.objectContaining()`
  for testing multiple properties in an object.
- Prefer asserting on specific error messages (e.g. `expect().toThrow("...")`) instead of error
  classes (e.g. `expect().toThrow(PermissionDeniedError)`) to ensure the correct error path is
  exercised.
- When running a single integration test with `bazel test`, prefer disabling flaky retries (set
  `--flaky_test_attempts=1`) to finish faster since one-at-a-time runs are unlikely to be flaky.
