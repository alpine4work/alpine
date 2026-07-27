# AGENTS.md

This package implements Alpine's public API. `ApiService` exposes Alpine content and mutations over
HTTP with an OpenAPI specification. The goal is not to expose an "integration subset" of Alpine. The
API content model should be rich enough that a developer could recreate Alpine using the API alone.

## Structure

- `api_service.ts` and `api_service_main.ts`: Boot `ApiService`.
- `internal/shared`: Shared API infrastructure like path registration, request context, and content
  conversion helpers.
- `internal/{documents,chat,forum,tasks,files,spaces}`: Feature-specific path definitions. Each
  package owns its own `api_*_paths.ts` file and tests.
- `internal/test_helpers`: Shared helpers for API integration tests.

Most endpoint work happens in feature `api_*_paths.ts` modules. Those modules should stay thin:

1. Parse the request.
2. Call the underlying server model/action code.
3. Convert Alpine content into API payloads on the way out.
4. Convert API payloads back into Alpine content on the way in.

## API Content Contract

Our API content format is a first-class representation of Alpine content, not a lossy export format.
It needs to round trip cleanly between:

- Markdown
- API content
- Alpine's internal content model

If a content shape cannot survive that round trip without semantic loss, it is not a good fit for
API content.

Some important consequences:

- A `GET` response should be authorable. Developers should be able to take the content from a `GET`
  and send it back to the matching `POST` or `PUT` without inventing missing structure.
- Reads and writes should share the same content vocabulary. Avoid creating read-only response
  shapes for content that cannot be submitted back to the API.
- References and display data should preserve author intent while still being renderable outside
  Alpine.

In practice this means response serializers should usually be built from
`intoApiContentWithReferences()` and request parsers should usually flow through `fromApiContent()`
or other narrowly scoped `fromApiContent*()` helpers.

## Round-Trip Testing

We rely on type tests and content round-trip tests to enforce these guarantees. When you change the
API content model or an endpoint payload shape, make sure the change still proves:

- Returned content is assignable to the corresponding write payload type.
- Markdown -> API content -> internal content -> API content remains stable.
- API content -> internal content -> HTML rendering preserves the same meaning.

Relevant tests live primarily in:

- `shared/api/content`
- `shared/api/markdown`
- `server/api/internal/*/*.test.ts`

When adding a new content feature, prefer adding a focused round-trip test close to the
serializer/parser pair that owns it.

## Design Principles

- Prefer complete, reusable payloads over endpoint-specific convenience shapes.
- For thread/message APIs, use API-facing nouns like `thread` and `message` in payload fields; avoid
  exposing `commentThread` or `comment` as response property names.
- Preserve semantics, not just appearance. Markdown and HTML should represent the same authored
  content the API stores.
- Keep the API expressive enough that an external developer can rebuild Alpine's core product
  surfaces against it.
- Treat response/write compatibility as a product requirement, not just an implementation detail.

## Actor Provenance

Actor payloads use `accountId` for the effective actor. Always populate `from` when the action was
performed through a different non-human actor, such as a bot acting on behalf of a human account. Do
not duplicate the same account in `from` just to indicate that the actor account is a bot.

## Consistency

Our API requires strong consistency. Data returned from the API should never be stale when compared
to the writes the API just accepted.

### Tasks and Task Collections

When an API endpoint commits task or task collection actions through
`commitTaskActionTransaction()`, pass `waitForProcessing: true`.

This matters because the API path may read the task or collection back before the commit has fully
finished. Without `waitForProcessing`, that follow-up read may hit `TaskRealtimeService` before it
has observed the action transaction, which breaks the read-after-write behavior the API expects.
