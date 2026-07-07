# server/agents/web

This package implements the "agent markdown web": the interface AI agents use to work with Alpine
data.

## Goal: AIX

We optimize for agent experience ("AIX", like UX or DX). Instead of learning 10 different tools from
5 different MCP servers, an agent working with Alpine gets a small set of primitive CRUD tools:
`create`, `read`, `update`, and `search` (plus utility `scroll` and `find` tools). Every tool speaks
Markdown. Editing is a simple string find-and-replace — a pattern agents have been trained heavily
on since coding agents depend on find-and-replace tools to edit code files.

To the agent, navigating Alpine should feel like navigating the web: `read` returns a Markdown
"page" full of links (`/task/write-spec`, `/document/onboarding`), and following a link is just
another `read`. Renames become 302-style redirects. The agent never sees internal IDs.

When making design decisions in this package, ask: "what would an agent trained on web browsing and
coding tools expect to happen?" That answer usually wins.

## Concepts

### Tools

- `read` (`call_agent_web_read_tool.ts`): Routes a path to a page, loads it from the Alpine API,
  prints it to Markdown, caches the response in session storage (responses expire after an hour),
  and returns it truncated to the requested byte `limit`. Some pages also load additional data until
  they fill the requested byte `limit`.
- `update` (`call_agent_web_update_tool.ts`): Find-and-replace of `old`/`new` strings against the
  cached `read` response. We parse the old and new Markdown into `AgentWebPage`s, diff them, and
  turn the diff into API calls. Requires a recent `read` of the same path.
- `create` (`call_agent_web_create_tool.ts`): Takes a `type` string, parses it into an
  `AgentWebPage`, and creates the entity via the API.
- `scroll` / `find` (`call_agent_web_scroll_tool.ts`, `call_agent_web_find_tool.ts`): Paginate and
  regex-search the cached `read` response without re-reading from the API. Useful since `read`
  truncates responses above the provided `limit`.
- `search` is part of the same tool suite agents see but is implemented outside this package.

### Pages

`AgentWebPage` (`agent_web_page.ts`) is the abstract representation behind every Markdown string the
tools return. Each page type lives in `pages/agent_web_${entity}_page.ts` and exports:

- `AgentWeb${Entity}Page` / `AgentWeb${Entity}PageMetadata` / `AgentWeb${Entity}PageWithMetadata`
  types. Metadata is internal bookkeeping invisible to the agent (e.g. a document version needed to
  prevent clobbering collaborative edits during `update`).
- `readAgentWeb${Entity}Page()` — load from the API and return the printed response.
- `printAgentWeb${Entity}Page()` — page → mdast tree (printed to a string with
  `printMarkdownTree()`).
- `parseAgentWeb${Entity}Page()` — mdast tree → page. Throws `InvalidArgumentError` with a display
  message for anything it can't interpret.
- `normalizeAgentWeb${Entity}Page()` — canonical form of a page for round-trip comparisons.
- `createAgentWeb${Entity}Page()` / `updateAgentWeb${Entity}Page()` — turn a parsed page (or a diff
  of old and new parsed pages) into API writes.

The core invariant every page must maintain:

```
parse(print(normalize(page))) === normalize(page)
```

Everything `read` returns must parse back. If you print something you can't parse, `update` breaks
for that page. The generative tests enforce this invariant with `fast-check` property tests.

### Links

`AgentWebPageLink` (`agent_web_page_link.ts`) — links are the pathname part of a URL and come in two
kinds:

- **Stored** links bind a human-readable pathname (`/task/write-spec`) to a stable internal target
  (a `TaskId`) in session storage. Print them with `createAgentWebPagerLinkPathname()` and resolve
  them with `routeAgentWebPageLinkPathname()`.

- **Routed** links derive a page from routing logic instead of storage, e.g.
  `/task/write-spec/comments` routes through the stored `/task/write-spec` link. See
  `route_agent_web_page_link_pathname.ts`.

URL search params (e.g. `?after=...`) modify what's shown within the page when it's read (e.g.
pagination or filters).

### Session storage

`AgentWebSessionStorage` (`agent_web_session_storage.ts`) persists per agent session (one
conversation thread): stored link pathnames, cached `read` responses, and various Markdown-printing
bookkeeping. It assumes exclusive access and is designed to be implementable on any key-value store.

### Pagination

`read` takes a byte `limit` and caches the full printed response in session storage. There are two
pagination modes, and when choosing between them while writing a `pages/agent_web_${entity}_page.ts`
file is the same call a web developer makes between one long scrollable page and a series of pages:

- **Scroll within one page** (the default): the page is one entity that exists in its entirety — a
  document, a task, a post. It doesn't make sense to split a document across multiple pages, so
  `read` prints the whole thing, returns the first `limit` bytes, and the agent uses `scroll` (or
  `find`) to move through the rest of the cached response. Every page gets this for free — there's
  nothing extra to implement.

- **Paginate across pages** (URL search params): the page fronts a collection that's unbounded over
  time — a chat or channel could be months, even years long, and it's not reasonable to load all of
  that onto one page. `read` loads only enough to fill `limit` and prints "Previous page"/"Next
  page" links whose search params (e.g. `/channel/general?before=42`) tell the next `read` where to
  resume.

When paginating across pages, we still want a single `read` to fill the requested `limit` — an agent
that asks for 10kb should get roughly 10kb. The pattern (see `readAgentWebChannelPage()` or
`readAgentWebTaskCollectionPage()`):

1. Fetch a batch from the paginated Alpine API and print the page. Keep fetching while the printed
   response is under `limit` and the API has a `nextCursor` (which means there's a next page).

2. The final batch usually overshoots `limit`. Truncate the printed string — don't re-print the page
   repeatedly hunting for the right size. Parse the printed Markdown and slice the string at an item
   boundary using mdast `position` offsets (see `truncateAgentWebMessagingPage()` or
   `truncateAgentWebChannelPage()`).

## Style guide

### Be liberal in what you accept when parsing

Postel's law applies to everything the agent sends us:

- Parse leniently where intent is unambiguous: case-insensitive field labels (`color: red`), stem to
  handle pluralized text (e.g. `collections` works for `collection`).
- Ignore what you can safely ignore instead of rejecting it (e.g. unsupported URL search params on
  `read`).
- But print canonically: one blessed output format per page, so `update`'s find-and-replace has a
  stable string to match against.
- Reject with a helpful error when guessing would be dangerous — never silently drop content the
  agent asked us to write.

### Error display messages (IMPORTANT)

Every error an agent can trigger needs a `displayMessage` built with the `errorDisplayMessage`
tagged template. The plain error `message` is for Alpine's internal developers. `message` is
included in our logs and so shouldn't contain customer data. The `displayMessage` is what the agent
reads to recover.

The `displayMessage` should have two parts:

1. **What went wrong**, in soft, non-accusatory language. Prefer "Unexpected …" or "Couldn't …" over
   "Invalid …" ("invalid" blames the author). Include references that pinpoint the failure: the
   quoted value, the line number (from mdast `position.start.line`), the path.

2. **What to try next**, as a suggestion, usually with a concrete example: "Try again with …", "Try
   again and remove …".

Examples from this package:

> A document can only have one markdown h1 (e.g. `# My Document`) and the h1 must be placed at the
> start of the document. You added an additional markdown h1 “Roadmap”. Try again but remove the
> additional markdown h1 or make it an h2 (e.g. `## My Sub-heading`).

> Can’t open a new `<message>` on line 12. There’s already an open `<message>` and you can’t nest
> messages.

> Expected a link to a human or bot on line 4. For example: `[John](/human/john-doe)`. Instead we
> found “Everyone”. Try again with a valid link to a human or bot.

Mechanics:

- Values interpolated into `errorDisplayMessage` are automatically marked as sensitive (hidden from
  logs), so interpolate user data freely.
- Quote text with curly quotes (`quoteMarkdown()` may also be helpful).
- Quote markdown with backticks if ou need to reference specific markdown formatting syntax.
- Try to avoid the word "account" — it's our internal noun for humans and bots. Refer to accounts
  generically ("them", "those", "their") or by their short name. "People" is fine when you know
  they're human (try to avoid calling bots "people"), and "humans or bots" can sometimes work when
  covering both.

## Tests

Every page type gets three kinds of tests:

1. **Page format tests** (`pages/agent_web_${entity}_page.test.ts`) using `runAgentWebPageTests()`.
   Makes sure pages print in the expected format. Useful for visually verifying the page format we
   print is good.
2. **Generative tests** (`pages/agent_web_${entity}_page_generative.test.ts`) using
   `runAgentWebPageGenerativeTests()` with `fast-check` arbitraries. These enforce the print/parse
   round-trip invariant on arbitrary pages and regularly catch printing edge cases that hand-written
   cases miss.
3. **Tool call tests** (`call_agent_web_${tool}_tool_for_${entity}.test.ts`) — one file per tool per
   page type:
    - Assert the full response string inline with `toEqual`. Makes it easy to visually verify the
      test output is correct.
    - `update`/`scroll`/`find` tests must `read` the path first to populate the response cache.
    - When a parse error should prevent writes, also assert zero write requests were made.
    - We never directly call `readAgentWeb${Entity}Page()` / `updateAgentWeb${Entity}Page()` /
      `createAgentWeb${Entity}Page()` in tests. Instead we test that logic through
      `callAgentWeb${Tool}Tool()`.
