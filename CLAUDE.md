# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Development Commands

**Build Commands:**

```bash
./admin/bin/dev check        # Run linting and formatting checks for changed files
./admin/bin/dev format       # Fix any linting and formatting issues in changed files
./admin/bin/dev format [...files] # Fix any linting and formatting issues in given files
```

**Unit Test Commands:**

```bash
./admin/bin/dev test         # Run tests for changed files
./admin/bin/dev test <file>  # Run tests for a specific file
```

**Integration Test Commands:**

```bash
./admin/bin/bazel run //app/integration_tests:{relative_path}_test # Run tests for a specific file
```

Example: `./admin/bin/bazel run //app/integration_tests:settings/settings_people_test`

**Integration test structure**:

-   `chat/` - Chat functionality tests
-   `documents/` - Document-related tests
-   `forum/` - Forum functionality tests
-   `settings/` - Settings page tests
-   `tasks/` - Task management tests

## High-Level Architecture

### Core Technologies

-   **Build System**: Bazel for hermetic builds and dependency management
-   **Frontend**: React + Remix framework with TypeScript
-   **Backend**: Node.js services with TypeScript
-   **Database**: DynamoDB (primary storage)
-   **Search**: OpenSearch for full-text search
-   **File Storage**: Cloudflare R2 for file uploads
-   **Real-time**: WebSocket framework for live collaboration
-   **Package Manager**: pnpm managed through Bazel

### Service Architecture

Cyberworlds is a multi-service application with these core services:

-   **App Service** (`app/`): Main web application server (Remix)
-   **Edge Service** (`server/edge/`): CDN edge functions (Cloudflare Workers)
-   **Job Queue Service**: Background job processing
-   **File Processor Service**: Background file processing

### Directory Structure

-   `app/` - Frontend React/Remix application and routes
-   `server/` - Backend services and shared server code
-   `client/` - Client-side React components and utilities
-   `shared/` - Code shared between client and server
-   `admin/` - Build tools, deployment, and development scripts

### Key Patterns

**RPC System**: Type-safe RPC calls between client and server

-   Definitions in `shared/rpc/`
-   Implementations in `server/rpc/` **WebSocket Framework**: Real-time collaboration system
-   Protocol definitions in `shared/web_socket/`
-   Server implementation in `server/web_socket/`
-   Used for chat, document collaboration, task updates, and more **Context System**: Dependency
    injection pattern
-   `ServerProcessContext` for process-level dependencies
-   `ServerActionContext` for request-level dependencies
    -   `ServerSessionActionContext` has the permissions of an individual user
    -   `ServerSystemActionContext` has access to everything in a single space
-   Modules for DynamoDB, jobs, tracing, etc. **Content System**: Rich text editing and
    collaboration
-   ProseMirror-based editor with real-time collaboration
-   Content schema in `shared/content/`
-   Content editor in `client/content/`
-   Collaborative editing (for documents specifically) in `server/documents/collaboration/`

### Testing

Only run tests if you're explicitly asked to. Our tests are expensive to run.

**Unit Tests**: Jest with TypeScript

-   Test files: `**/*.test.{ts,tsx}`

**Integration Tests**: Playwright

-   Test files: `app/integration_tests/**/*.spec.ts`

### Code Quality

**TypeScript**: Strict configuration with comprehensive type checking

**ESLint**: Custom rules for code quality and consistency

**Prettier**: Automated code formatting

**Bazel**: Hermetic builds with dependency graph analysis Run `./admin/bin/dev check` before
committing to ensure code quality standards.

## Code Style

Whenever you edit or add any file, _always_ run formatting before finishing your operation. To run
our formatters, run:

```bash
./admin/bin/dev format            # All changed files
./admin/bin/dev format [...files] # Specific files
```

**General**

-   Always use ES Module absolute imports starting with `~/` and ending with the file extension
    `.js`
-   Our person type is called "account" instead of "user"
-   Don't use `SCREAMING_SNAKE_CASE` for constant names, instead use `camelCase`
-   Your programming doesn't let you write curly quotes (e.g. `“` or `’`), use `\u` escapes instead
-   Use direct coding style - Functions should read naturally; use assertions vs null checks; throw
    on not found vs returning null
-   Put smallest branch first and return early - Shortest condition first, use early returns to
    reduce indentation
-   Don't use try/catch for control flow - Only for exceptions; provide explicit variants like
    getChannel(), getChannelIfExists(), getChannelIfPossible()

**Naming**

-   File names should be snake_case - All files use snake_case for consistency with Bazel and should
    follow the name of their primary export
-   File names should be globally unique - No two files should have same name; prefix with namespace
    if needed
-   Avoid default exports, prefer named exports
-   Exported names should be globally unique - Add namespaces to make exports unique across codebase
-   Prefer direct function names for common case - Short name for most-used function; add suffixes
    like IfExists for variants
-   Prefer long, descriptive names - Use verbose names over short ones with docs; include context
    like "fooForBar" or "fooWithBar"
-   Recommended type naming convention - {namespace}{subClass}{superClass}{member} pattern for
    PascalCase types
-   Variable names should mirror type names - Start with type name, convert to camelCase, remove
    namespace if local

**Function Arguments**

-   Prefer named arguments after 4 parameters - Also for 2+ same-type params or any boolean params

**Comments**

-   80 character length - Comments wrap at 80 chars not including indentation
-   Use markdown formatting - Format comments as markdown for tool compatibility
-   Block comments for docs, inline for implementation - JSDoc /\*\* for public API, // for
    implementation details

**TypeScript**

-   Helper functions in individual modules - Avoid \_utils.ts files; one helper per file
-   Prefer function declarations - Use function foo() not const foo = () => for module scope
-   Avoid classes - Prefer discriminated unions and composition over inheritance
-   When using classes, only extend abstract classes - Super classes should be abstract; add Base
    suffix
-   Avoid shared mutability - Local mutation OK, but don't mutate shared objects; prefer immutable
    patterns

**React**

-   Avoid React context - Prefer prop drilling; only use context for system-level functionality
-   Call preventDefault() and stopPropagation() on keydown - Always use both for keyboard events
-   Avoid stopPropagation() for other events - Only use for keydown; parents depend on event
    propagation
-   Create component local stacking context with z-index - Use position: relative; z-index: 0 for
    local z-order reasoning
-   Treat data-testid as test-only - Don't use in production code; only for test element selection
-   Protect useEffect network requests with refs - Track values with refs to prevent unnecessary
    requests

**Testing**

-   Use describe blocks for grouping - Group by API or functionality; don't just prefix test names
-   Use parameterized tests - Extract test cases outside test functions; include values in test
    names
-   Assert everything relevant, nothing more - Comprehensive but focused assertions; avoid testing
    unrelated behavior
-   Aim for one `expect()` per test at the end of the test. Each test should be checking one thing.
    Use `expect().toMatchObject()` for testing multiple properties in an object

The full code style ruleset can be found in `admin/docs/code_style.md`, if needed.
