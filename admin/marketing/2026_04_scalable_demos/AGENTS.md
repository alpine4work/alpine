# Scalable Demo Content Format

This directory houses Alpine's **scalable demo video format** — the short, daily social media demos
we started posting April 2026. Each demo is two halves glued together:

1. **A Playwright-driven screen recording** of the Alpine app, seeded with fixture data (spaces,
   accounts, documents, chats, etc.).
2. **A Remotion composition** that trims and frames the recording for export. New demos should
   default to the plain full-frame composition style used in demos 023+ unless there's a specific
   reason to do something custom.

> **When you discover a new way to add an entity or interaction to a demo, update this file in the
> same change.** The cookbook only stays useful if it reflects how we actually build demos today.

**The fictional universe — characters, company, projects, timeline, voice — is defined once in
[`admin/environment/demo_space/UNIVERSE.md`](../../../admin/environment/demo_space/UNIVERSE.md).**
Read it before writing any seeded content. UNIVERSE.md is shared across demos, screenshots, and
marketing materials so they all feel like they come from the same company at the same moment in
time. When you write a document title, a chat message, a post body, a task name, or any
human-authored content for a demo: follow the persona voices, the company context, the ongoing
projects, and the September 8 – October 17, 2025 timeline from UNIVERSE.md. Don't invent parallel
facts.

---

## How to scaffold a new demo

Run `dev demo new` (prompts for a snake*case name, or pass `--name`). This creates the three
`demos/{NNN}*{name}_demo\_\_.{ts,tsx}`files from`demos/000*demo*_.template.\*`, registers the composition in `scalable_demos_remotion_root.tsx`, and adds a placeholder entry to `SCALABLE_DEMOS_REPOSITORIES`. Other `dev
demo` subcommands:

- `dev demo studio` — launch Remotion Studio
- `dev demo assets` — build the `:public` filegroup (run after adding a real URL + integrity to
  `scalable_demo_repositories.bzl`)
- `dev demo content-prompt` — generate X/LinkedIn post text. With no args it stays interactive; for
  scripting use flags like `--platform=x --demo=027 --url=... --notes="..." --output=...`
- `dev demo run <number-or-name>` — run the recorder for an existing demo. Accepts a bare number
  (`5`), zero-padded (`005`), or the full leading slug (`005_export_table_to_markdown`). Shorthand
  for `bazel run //admin/marketing/2026_04_scalable_demos:{NNN}_{name}_demo_recorder`.

---

## Remotion

We use Remotion for generating videos. You can start Remotion Studio like this:

```bash
admin/marketing/2026_04_scalable_demos/remotion_studio.sh
```

Whenever you need to update the available assets run:

```bash
bazel build //admin/marketing/2026_04_scalable_demos:public
```

This will also show you the list of assets available via the `remotionFile()` helper function.

> **Note:** This doesn't run files through our Bazel TS -> JS build pipeline. All other code in our
> monorepo is compiled to JS through Bazel (via SWC with custom plugins). For convenience, we make
> an exception for this marketing code which is compiled entirely through Remotion. Anything that
> depends on our custom SWC plugins won't work in Remotion's studio environment.

## Demo file structure

Each demo lives in `demos`. A demo has the name `${number}_${name}`. `number` is an incrementing
integer we add to make sure all our demos are listed in the order they were created. `name` is a
unique name for the demo.

Demos have the following parts:

- `demos/${number}_${name}_demo_recorder.ts`: This uses Playwright and our integration test
  environment to setup the app for a demo screen recording (could be one or more videos). Add demo
  data and add instructions for how the human should pilot the app in the screen recording. Run the
  recorder with
  `bazel run //admin/marketing/2026_04_scalable_demos:${number}_${name}_demo_recorder`. This will
  use Playwright to launch a browser and will wait for the human to take the screen recording. As a
  shortcut you may omit the demo name and just write the number:
  `bazel run //admin/marketing/2026_04_scalable_demos:${number}`.

- `scalable_demo_repositories.bzl` contains the map `SCALABLE_DEMOS_REPOSITORIES` which is all our
  source video assets. The workflow is:
    1. You (typically a human, not a coding agent) use the recorder to take a screen recording.
    2. You (typically a human, not a coding agent) upload the video asset to the
       [`2026_04_scalable_demos` folder on Google Drive](https://drive.google.com/drive/folders/1Uv1E0DEcgCn7PZTDzfIcmfTh-VvTpgEB?usp=drive_link).
       By convention we like to name our video assets `recording_${takeNumber}.mov`.
    3. Add the link to the uploaded video asset to `SCALABLE_DEMOS_REPOSITORIES`. This file will be
       made available to Remotion. If the video is in the `.mov` format then we convert it to
       `.webm`.
    4. The video is now available in Remotion via `remotionFile()` using the file name from
       `SCALABLE_DEMOS_REPOSITORIES`.

- `demos/${number}_${name}_demo_composition.tsx`: The Remotion composition used for rendering the
  final demo video. You need to import this file in `scalable_demos_remotion_root.tsx` and add a new
  `<Composition>` component. This `*_demo_composition.tsx` file should ONLY export a Remotion
  composition React component. This makes iteration with React Refresh a lot nicer since React
  Refresh only needs to hot reload the composition component when it changes instead of the entire
  Remotion studio (which may happen if you export anything else, e.g. a number or string or object).

- `demos/${number}_${name}_demo_shared.ts`: A place for constants shared between the
  `*_demo_recorder.ts`, `*_demo_composition.tsx`, and `scalable_demos_remotion_root.tsx` files. For
  example, you may want to share the demo viewport width between `*_demo_recorder.ts` and
  `*_demo_composition.tsx`. Or the demo duration in frames between `*_demo_composition.tsx` and
  `scalable_demos_remotion_root.tsx`. (Video duration must be defined in
  `scalable_demos_remotion_root.tsx`, when it changes the entire Remotion studio must re-render.)

- `bazel run //admin/marketing/2026_04_scalable_demos:content_prompt` uses the Claude Code CLI to
  help you generate X and LinkedIn text for your demo. With no args it prompts for platform, demo,
  and notes. For scripting you can pass `--platform=x|linkedin`, `--demo=<number-or-slug>`,
  `--url=<public-recording-url>`, `--notes="..."`, and `--output=<path>`. The tool uses the
  `*_demo_recorder.ts` code you wrote to understand what the demo is about, so make sure the
  `instructions` in your `*_demo_recorder.ts` file are useful both for humans and for agents.

### When asked to generate demo content

When the request is something like "generate content", "write the X and LinkedIn copy", or "run
content generation" for one or more demos:

- Prefer the **non-interactive** path via `dev demo content-prompt --platform=... --demo=...`.
- Look up the public recording URL in `scalable_demo_repositories.bzl` and pass it with `--url`.
- Pass short, concrete framing with `--notes` so the prompt emphasizes the right hook.
- Save each generated result with `--output=...` and then assemble the outputs into a markdown file
  in this directory for review.
- If no CLI args are provided, the tool remains interactive; use that only when the user wants to
  drive the selection manually.
- If `CLAUDE_CODE_OAUTH_TOKEN` is missing in this worktree, check sibling worktrees for the same
  local env var and copy it into the local development env file before running the generator.

---

## The demo space — use it by default

Prefer **`createDemoSpace()`** from `//admin/environment/demo_space` over ad-hoc
`TestSpace.create()` whenever the demo will show an account's name/avatar or needs more than one
person in it. The demo space is one "Alpine" space with seven pre-seeded accounts — the same cast
defined in [`UNIVERSE.md`](../../../admin/environment/demo_space/UNIVERSE.md#cast) — each with a
consistent avatar.

```ts
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());
    // accounts.cassCade, accounts.roseCompas, accounts.mattRHorn, ...
});
```

The code-level quick reference — for the voice, tenure, working hours, and "typical content" of each
persona, read their section in `UNIVERSE.md`:

| Account key      | Display name    | Role in UNIVERSE.md    |
| ---------------- | --------------- | ---------------------- |
| `cassCade`       | Cass Cade       | Chief of Staff (Admin) |
| `roseCompas`     | Rose Compás     | CEO (Owner)            |
| `mattRHorn`      | Matt R. Horn    | Product Designer       |
| `masonClay`      | Mason Clay      | Engineer (Frontend)    |
| `elleKappaTan`   | Elle Kappa-Tan  | Engineer (Backend)     |
| `cliffWeathers`  | Cliff Weathers  | Account Executive      |
| `hollyEvergreen` | Holly Evergreen | Marketing + CS         |

**Persona voice cheat sheet** (details in `UNIVERSE.md`):

- **Rose** — direct, unhedged, sparing. Vision documents and high-stakes forum posts.
- **Cass** — organized, decisive, millennial. ~1-in-10 casual chat messages uses "lol", "omg",
  "tbh". Never in docs or formal posts.
- **Elle** — Gen-Z, **all lowercase, no punctuation** in chat/task comments. Exception: technical
  docs and postmortems are written normally.
- **Mason** — Gen-Z, clear but loose in chat. Drops terminal periods, uses phrases like "This is
  cooked", "Lowkey not sure", "Idk feels off". No heavy emoji.
- **Matt** — abstract, first-principles, references design/typesetting history. Specific feedback,
  sweeping reasoning.
- **Cliff** — upbeat, competitive, exclamation points, pipeline-focused. Clear structured notes when
  something blocks a deal.
- **Holly** — warm, thorough. Occasional millennial emoji (🙌 💯 😅 ✨) — only in casual chat, never
  in docs or announcements.

**Most demos are shot from Cass's perspective** (per `UNIVERSE.md`'s "Perspective" section), which
is why the `cassCade` account is the default driver in the cookbook snippets below. Pick a different
driver only when there's a specific in-fiction reason (e.g. Matt's design review doc, Elle's
postmortem).

Use `createDemoSpaceWithoutUploadingAvatars(context)` when the demo doesn't need avatar images —
it's meaningfully faster.

Single-person demos (demo 001, 003, 005) still use a throwaway
`TestSpace.create(context, {name: "Alpine"})` + `space.createSession()`. Fine for demos where no
human face appears.

**Composition default.** New demos should use the plain full-frame composition template like demos
023–026: no desktop background, no reaction character, just the recorded app footage trimmed inside
the export frame. Only reach for a custom composition when the recording shape truly demands it.

---

## Cookbook

All snippets below assume `session = accounts.cassCade` (a `TestSpaceSession`) unless noted. The
`TestSpaceSession` has a `.space`, `.account`, and an `.action()` context used by lower-level
helpers.

### Documents

```ts
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const document = await TestDocument.create(accounts.cassCade, {
    title: "Q2 Product Roadmap",
    access: "Public", // or "Private" (default)
    body: markdown`
        | Project    | DRI  | Priority |
        | ---------- | ---- | -------- |
        | Grants Nav | Cass | Medium   |
    `,
});

// Render the preview so suggested/search surfaces show it.
await document.updateContentPreview();
```

Other handy methods: `document.type(session, "text")` (types content at the current cursor),
`document.update(session, ...)`, `document.access.grantDefault(session)`.

**Uploading fixture images into a document** — use `uploadDemoFile` from
`~/admin/marketing/2026_04_scalable_demos/helpers/upload_demo_file.js`. Fixture files for demos live
in `admin/marketing/2026_04_scalable_demos/fixtures/` (not `admin/scenarios/fixtures/`). The
function uploads through the real `/api/files/:spaceId/upload` endpoint and returns a `FileModel`
whose `.id` you can use in `fileRow`, `fileFloat`, or `file` ProseMirror nodes.

```ts
import {uploadDemoFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/upload_demo_file.js";

const file = await uploadDemoFile(
    services.getAppServiceTokenAgent(),
    accounts.cassCade,
    "tmm_book_cover.jpg", // filename inside admin/marketing/2026_04_scalable_demos/fixtures/
    {type: "Document", documentId: document.id},
);

// Insert as a fileFloat (left-floated image, text wraps around it):
const schema = DocumentContentProsemirrorSchema;
await document.update(accounts.cassCade, [
    new ReplaceStep(
        insertPos,
        insertPos,
        new Slice(
            Fragment.from(
                schema.nodes.fileFloat.create({direction: "left"}, [
                    schema.nodes.file!.create({fileId: file.id}),
                ]),
            ),
            0,
            0,
        ),
    ),
]);

// Or as a centered fileRow:
await document.attachFile(accounts.cassCade, file);
```

To insert a `fileFloat` at the right position, call `document.getContent()` and walk
`content.content.content` (the top-level child nodes), summing `node.nodeSize` to find the insertion
point. Insert **after** a heading by summing nodeSize up to and including that heading node.
Re-fetch content between successive inserts since each step shifts positions. See demo 022 for a
full example.

**Document comment threads** — this is what the blue highlighted text + comment bubble is in the
editor:

```ts
await document.createCommentThread(
    accounts.roseCompas,
    {from: 50, to: 75}, // character range in the doc body
    "This section needs more detail.",
);

// Or anchor to a node (block-level comment):
await document.createCommentThread(accounts.roseCompas, {isNode: true, pos: 100}, "…");
```

The returned `TestDocumentCommentThread` has `.createComment(session, text)` and
`.setReaction(session, emotion)`.

### Forum channels, posts, and post comments

```ts
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";

const channel = await TestChannel.create(accounts.cassCade, {
    name: "Engineering",
    access: "Public", // or "Private"
});

const post = await channel.createPost(
    accounts.elleKappaTan,
    markdown`
        ### Incident retrospective: upload backlog

        ...
    `,
    {
        // Realistic timestamps let the feed show the time-ago relative to when the demo
        // was recorded.
        overrideCreatedTime: new Date("2026-05-21T11:10:00-04:00"),
    },
);

// Reactions — emotion strings use the reactor's character. `"GenericLike"` is the
// characterless "thumbs up" equivalent.
await post.setReaction(accounts.masonClay, "ThankYou");
await post.setReaction(accounts.cassCade, "Heart");
await post.setReaction(accounts.elleKappaTan, "GenericLike");

// Comments on posts
const comment = await post.createComment(accounts.mattRHorn, "Nice write-up");
await comment.setReaction(accounts.cassCade, "Happy");
```

Reference implementation:
[`admin/scenarios/internal/fictional_ambrook_demo_feed.ts`](../../scenarios/internal/fictional_ambrook_demo_feed.ts).

### Chat (1:1, group, room)

```ts
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";

// Direct chat. Passing 2+ accounts creates a group chat between them all.
const chat = await TestChat.get(accounts.cassCade, accounts.elleKappaTan);

const msg = await chat.sendMessage(accounts.cassCade, "Hi Elle!", {
    overrideCreatedTime: new Date("2026-05-24T09:12:00-04:00"),
});

// Reply to a specific character range inside an earlier message (what the UI calls
// "reply to text"). startIndex/endIndex refer to the message index in the chat;
// startPos/endPos are character offsets inside the message content.
await chat.sendMessage(accounts.elleKappaTan, "Totally agree", {
    parent: {
        type: "MessagesRange",
        startIndex: msg.index,
        endIndex: msg.index,
        startContentVersion: 0,
        endContentVersion: 0,
        startPos: 141,
        endPos: 157,
    },
});

await msg.setReaction(accounts.elleKappaTan, "Heart");

// Named room (Slack-channel style)
const room = await TestChat.createRoom(accounts.cassCade, {
    name: "Fundraising",
    access: "Private",
});
```

Reference implementation:
[`admin/scenarios/internal/fictional_ambrook_demo_chats.ts`](../../scenarios/internal/fictional_ambrook_demo_chats.ts).

### Tasks

```ts
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {CalendarDate} from "@internationalized/date";

const parent = await TestTask.create(accounts.cassCade, {title: "Q2 launch"});
const child = await TestTask.create(accounts.cassCade, {
    parent,
    title: "Design homepage",
    assignee: accounts.mattRHorn,
    priority: "High", // "High" | "Medium" | "Low"
    dueDate: new CalendarDate(2026, 5, 20),
});

// TaskStatus is binary: "Open" (default) or "Closed".
await child.updateStatus(accounts.mattRHorn, "Closed");

// To show a task as "in progress" in the UI, leave the status Open and mark the
// assignee as Active. TaskAssigneeStatus is separate from TaskStatus.
await child.updateAssigneeStatus(accounts.mattRHorn, "Active"); // or "Inactive"

const comment = await child.createComment(accounts.roseCompas, "Looking great");
await comment.setReaction(accounts.mattRHorn, "ThankYou");
```

Use `runAllPromises([...])` when creating siblings in bulk (see demo 003).

**Task notes (the body shown in the hover preview and task page).** The notes editor starts as
`doc > paragraph(empty)` with content positions 0–2.

- For plain inline text, use `task.typeNotes(session, "text")` — it appends inline content inside
  that initial paragraph and advances the internal cursor. Accepts a string, a single `Node`, an
  array of inline `Node`s, or a `Fragment`.
- For **block-level content (headings, multiple paragraphs, etc.)** `typeNotes` can't help — it only
  inserts at an inline position. Replace the initial paragraph with a block sequence via
  `updateTaskNotesContent` directly:

```ts
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {updateTaskNotesContent} from "~/server/tasks/data/update_task_notes_content.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

const notesSchema = TaskNotesContentProsemirrorSchema;
const notesBlocks = [
    // Heading levels are 1–3 in the schema. `level: 2` matches what a `###` in
    // markdown parses into (h3 → level 2).
    notesSchema.node("heading", {level: 2}, [notesSchema.text("Summary")]),
    notesSchema.node("paragraph", {}, [notesSchema.text("Short description…")]),
    notesSchema.node("heading", {level: 2}, [notesSchema.text("Motivation")]),
    notesSchema.node("paragraph", {}, [notesSchema.text("Why we\u2019re doing this…")]),
];

// `version: 0` — freshly-created task, no prior edits. `ReplaceStep(0, 2, …)`
// replaces the entire initial empty paragraph (positions 0 → 2) with the new block
// sequence. `Slice(…, 0, 0)` means the fragment is fully enclosed at doc depth.
await updateTaskNotesContent(accounts.cassCade.action(), {
    spaceId: space.id,
    taskId: projectTask.id,
    version: 0,
    steps: [new ReplaceStep(0, 2, new Slice(Fragment.from(notesBlocks), 0, 0))],
});
```

Reference implementation: the project-notes block in demo 011
(`011_search_project_preview_demo_recorder.ts`).

### Projects vs task collections

Alpine has two overlapping "grouping" shapes for tasks. Pick the right one:

- **Project** = a `TestTask` with `layout: "Project"`. It _is_ a task, and its children set
  `parent: projectTask`. Use for a single tracked deliverable whose child tasks are the work (e.g.
  "Mobile App Redesign" with a list of engineering + design subtasks). Affinity and search entity
  ID: `` `Task:${projectTask.id}` ``.
- **Task collection** = `TestTaskCollection.create(session, {name})`. A named bucket that tasks
  belong to via the `collections: [...]` field. Use for cross-cutting groupings where one task can
  live in multiple buckets (e.g. a sprint — a task can be in "Sprint 2026 Q2" _and_ in a feature
  collection). Affinity and search entity ID: `` `TaskCollection:${collection.id}` ``.

Both surface in search with their own interactive preview. If the demo is about a single project
with a clean hierarchy of child tasks, reach for `layout: "Project"`. If the demo is about
cross-cutting planning or sprint-style grouping, reach for `TestTaskCollection`. See demo 011 for a
project example and `fictional_ambrook_sprint_tasks.ts` for a collection-heavy example.

### Adding more users to an existing space

```ts
// Seed extra accounts alongside the demo space crowd.
const observer = await space.createSession({
    name: "Casey Observer",
    role: "Member",
    reactionCharacter: {type: "Cat", variant: "Pink"},
});

// Or pull an existing TestAccount into the space.
await space.addAccount(someExistingTestAccount, "Member");

// Dangle an invite without accepting (shows up as pending):
await space.inviteEmailAddress(accounts.cassCade, "guest@example.com");
```

### File attachments (images, attachments in posts)

Fixture files live in `admin/scenarios/fixtures/` and are uploaded through the app's real
`/api/files/:spaceId/upload` endpoint so they end up with real `fileId`s. From a demo recorder:

```ts
import {uploadScenarioFile} from "~/admin/scenarios/internal/upload_scenario_file.js";

const file = await uploadScenarioFile(
    services.getAppServiceTokenAgent(),
    accounts.cassCade,
    "fictional_ambrook_unsplash_inspiration_1.jpg",
    {type: "Document", documentId: document.id},
);

await document.attachFile(accounts.cassCade, file);
```

For posts with image galleries (demo 002), the fixture files are dropped into the browser via
Playwright rather than pre-attached — see `002_image_gallery_demo_recorder.ts`.

Need a programmatic blank file (e.g. for non-visual attachment tests)? `TestFile.create(session)`
from `//server/files/test_helpers`.

### Reactions summary

All four interaction surfaces use the same `.setReaction(session, emotion)` pattern. The reactor's
character (from their `TestSpaceSession`) is combined with the emotion:

| Entity                  | Helper path                                 |
| ----------------------- | ------------------------------------------- |
| Forum post              | `post.setReaction(session, "Heart")`        |
| Forum post comment      | `comment.setReaction(session, "ThankYou")`  |
| Document comment thread | `thread.setReaction(session, "Happy")`      |
| Chat message            | `message.setReaction(session, "Heart")`     |
| Task comment            | `comment.setReaction(session, "Celebrate")` |

`"GenericLike"` is the one special value — it renders as a plain thumbs-up without the character.

### Mentions

**Whenever seeded content references a person, document, or other entity by name, render it as an
inline mention link.** Mentions make the demo feel like a real, connected workspace — plain-text
names feel like a screenshot, mentions feel like a product. Use them in document bodies, post
bodies, chat messages, and task notes.

The URL shape is `https://alpine.inc/{entityPath}?mention`. The `?mention` query parameter tells the
renderer to display the link as an inline mention chip rather than a plain hyperlink. The link text
in the markdown is a fallback label; the UI replaces it with the real entity name at render time.

**Account mentions use `?mention=short` by default**, which renders the person's first name only
(e.g. "Mason" instead of "Mason Clay"). Use plain `?mention` only when you specifically want the
full name.

| Entity   | URL path                       |
| -------- | ------------------------------ |
| Account  | `/mention/{accountId}?short`   |
| Document | `/doc/{documentId}?mention`    |
| Channel  | `/channel/{channelId}?mention` |
| Task     | `/task/{taskId}?mention`       |

Because the `markdown` tag doesn't support interpolation (see Style & authoring tips), build a
helper and use placeholder + `.replace()`:

```ts
const mentionUrl = (session: {account: {id: string}}) =>
    `https://alpine.inc/mention/${session.account.id}?short`;

const body = markdown`
[Mason](MASON_MENTION) is leading the redesign. [Elle](ELLE_MENTION) is scoping SSO.
`
    .replace("MASON_MENTION", mentionUrl(accounts.masonClay))
    .replace("ELLE_MENTION", mentionUrl(accounts.elleKappaTan));
```

For document mentions:

```ts
const docMentionUrl = `https://alpine.inc/doc/${document.id}?mention`;

const body = markdown`
Full context in the [FY2026 Q2 Update](DOC_MENTION).
`.replace("DOC_MENTION", docMentionUrl);
```

Reference implementation: `014_feed_post_with_collection_preview_demo_recorder.ts`.

### Feed entries (hero feed / demo feed surfaces)

Feed entries aren't written into the database. They're **passed through a URL query param to the
special `/dev/feed/{spaceId}` page**, which renders them as if they came from the real feed. This is
what `landing_page_scenario.ts` and the hero/demo scenarios do:

```ts
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {UrlPath} from "~/shared/routing/url_path.js";

const entries: Array<FeedEntry> = [
    {
        type: "Post",
        postId: post.id,
        channelId: channel.id,
        authorId: accounts.cliffWeathers.account.id,
        createdTime: post.createdTime,
    },
    {
        type: "Document",
        documentId: document.id,
        sharedTime: new Date("2026-05-22T13:38:00-04:00"),
        sharerId: accounts.cassCade.account.id,
        creator: {id: accounts.cassCade.account.id, from: null},
        event: "SharedWithAccessPolicyDefaultGrant",
    },
];

const url = new UrlPath(`/dev/feed/${space.id}`);
url.searchParams.set(
    "entries",
    JSON.stringify(Schema.array(FeedEntrySchema).serialize(entries)),
);

await recorder.record({session: accounts.cassCade, path: url.toString(), ...});
```

References:
[`admin/scenarios/internal/fictional_ambrook_demo_feed.ts`](../../scenarios/internal/fictional_ambrook_demo_feed.ts),
[`admin/scenarios/internal/fictional_ambrook_hero_feed.ts`](../../scenarios/internal/fictional_ambrook_hero_feed.ts).

### "Add this to the suggested list" = affinity points

Alpine's suggested / affinity surfaces (suggested docs in search, suggested accounts, etc.) are
ranked per-account by affinity points. When a demo wants a specific entity to appear at the top of a
"suggested" list from someone's perspective, **that's affinity points**. Use
`addSearchAffinityEntityPointsForTest` — it's test-only and writes directly to the
`SearchEntityTable`. No indexer call needed.

```ts
import {
    addSearchAffinityEntityPointsForTest,
    favoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";

// "Rose's pitch deck should be the #1 suggestion from Cass's perspective."
await addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
    spaceId: space.id,
    accountId: accounts.cassCade.account.id, // whose perspective
    entityId: `Document:${pitchDeckDocument.id}`,
    points: 999_000_000, // large values dominate ordering
});

// Optionally also mark as "⭐ favorite" so it pins to the top regardless of
// affinity decay.
await favoriteSearchEntity(accounts.cassCade.action(), {
    spaceId: space.id,
    entityId: `Document:${pitchDeckDocument.id}`,
});
```

Supported `entityId` shapes (from `shared/search/search_entity_id.ts`):

- `` `Account:${AccountId}` ``
- `` `Document:${DocumentId}` ``
- `` `Channel:${ChannelId}` ``
- `` `Chat:${ChatId}` ``
- `` `Task:${TaskId}` ``
- `` `TaskCollection:${TaskCollectionId}` ``
- `` `Site:${SiteId}` ``
- `"TaskPersonal"` (no ID — the personal task list)

**To control the order within a suggested list**, decrease the point value monotonically across
entries (`999_000_000`, `998_000_000`, `997_000_000`, ...). The full sequence is laid out in
[`admin/scenarios/internal/fictional_ambrook_suggestions.ts`](../../scenarios/internal/fictional_ambrook_suggestions.ts)
— copy that pattern.

### Inbox / notifications

Inbox entries are generated automatically by the actions above (posts mentioning an account, new
comments on a document, chat messages). Verify they landed (notifications are asynchronous) with
`getInboxEntry`/`getInbox` + `retryWithExponentialBackoff`:

```ts
import {getInboxEntry} from "~/server/notifications/inbox/inbox_actions.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";

await retryWithExponentialBackoff(async retry => {
    try {
        const entry = await getInboxEntry(accounts.cassCade.action(), {
            spaceId: space.id,
            key: {type: "Chat", chatId: chat.id},
        });
        assert(entry.model.loudNotificationCount > 0);
    } catch (error) {
        throw retry(error);
    }
});
```

Full example:
[`admin/scenarios/internal/fictional_ambrook_demo_inbox.ts`](../../scenarios/internal/fictional_ambrook_demo_inbox.ts).

---

## Recorder mechanics

Every demo wraps its setup in:

```ts
runScalableDemoRecorder(async (context, services, recorder) => {
    // ...setup...
    await recorder.record({
        // A numbered list of steps the human should take to record the demo Use \u201C and
        // \u201D to wrap buttons or typed content.
        instructions: markdown`
1. Highlight the text \u201CMy text\u201D

2. Press \u201CReply\u201D. Do not move your mouse! Start typing instead.

...
        `,
        // The user to act as in the demo
        session: accounts.cassCade,
        // The starting page for the demo
        path: `/doc/${doc.id}`,
        // The size of the viewport
        viewport: {width: scalableDemoNarrowViewportWidth},
        // Anything to run in the browser before we start. Default to toggling the
        // spaceSideBar visibility
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
```

Handy knobs:

- **Viewport.** Default is `scalableDemoDefaultViewport`; narrow is
  `scalableDemoNarrowViewportWidth`. Omit `height` and it's computed from width / golden ratio.
  **Use narrow when the sidebar will be hidden in `prepare` — use `scalableDemoDefaultViewport`
  (1280 wide) when the sidebar needs to stay visible** (e.g. the viewer is going to click the search
  entry point). When you switch a demo to default viewport, also update the composition and the
  `<Composition width={…}>` in `scalable_demos_remotion_root.tsx` to use
  `scalableDemoDefaultViewportWidth` so the frame matches. See demos 023–026 for the current
  full-frame pattern.
- **`prepare`.** Runs after the page loads, before instructions are shown to you. Good for hiding
  the sidebar, dismissing tooltips, pre-filling a field, etc. `dev.spaceSideBar.toggleVisibility()`
  is the canonical sidebar hide. Omit `prepare` entirely when the demo needs the sidebar to stay
  visible.
- **`session: null`.** Records a logged-out view (landing / marketing pages).
- **`instructions`.** Human-readable markdown that shows up in your terminal before you press
  record. **Write these well** — the `dev demo content-prompt` tool reads them to generate post
  copy.
- **`actions`.** An array of async Playwright callbacks that run automatically in the primary
  (headed) browser window — the one the human is screen-recording. Use this when every interaction
  in the demo can be driven by Playwright (typing, clicking, waiting for elements) so the recording
  is perfectly reproducible without manual piloting. Mirrors the collaborator `actions` interface
  but drives the main session.

    ```ts
    actions: [
        async page => {
            const input = page.getByLabel("New message");
            await input.click();
            await input.pressSequentially("Finished the design spec — ", {delay: 40});
            await input.pressSequentially("@Email", {delay: 60});
            await page.getByRole("option", {name: "Email Integration"}).waitFor();
            await page.keyboard.press("Return"); // insert mention
            await page.keyboard.press("Enter");  // send message
        },
    ],
    ```

    **Timing model.** The `actions` array runs sequentially (action 2 waits for action 1 to finish).
    If `collaborators` actions are also specified, these actions run concurrently with the `actions`
    array. There is no built-in delay scheduling — use `wait(ms)` when you need a pause.

    **Cursor + typing pattern.** For polished automated demos, prefer the fake cursor helper from
    `~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js` over raw Playwright mouse
    jumps. It animates smoothly, can mirror CSS cursor changes, and keeps clicks looking human.

    ```ts
    import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
    import {wait} from "~/shared/helpers/async/wait.js";

    actions: [
        async page => {
            const searchButton = page.getByRole("button", {name: "Search"});
            const searchInput = page.getByTestId("SearchModal").locator("input").first();

            const cursor = await createDemoCursor(page, {
                scale: 1.5,
                watchCssCursor: true,
            });

            await cursor.hide();
            await wait(400);
            await cursor.jumpTo(120, 220);
            await cursor.show();
            await wait(600);
            await cursor.moveToElement(searchButton, 1000);
            await cursor.clickElement(searchButton, 700, {watchCssCursor: true});

            await searchInput.waitFor({state: "visible"});
            await cursor.clickElement(searchInput, 800, {
                watchCssCursor: true,
                xOffset: -180,
            });
            await cursor.setCursorType("text");
            await wait(200);

            await searchInput.pressSequentially("tasks closed by mason last week", {
                delay: 70,
            });
        },
    ],
    ```

    Helpful cursor methods:
    - `cursor.jumpTo(x, y)` — instant reposition before the viewer should notice the cursor.
    - `cursor.moveToElement(locator, durationMs)` — smooth move to the element center.
    - `cursor.clickElement(locator, durationMs, {xOffset, yOffset})` — natural click inside a
      target.
    - `cursor.setCursorType("text" | "default" | "pointer")` — force the visible cursor when needed.
    - `cursor.hide()` / `cursor.show()` — hide between beats so dead time feels intentional.

    For typing, prefer `locator.pressSequentially("...", {delay})` when the text is going into a
    focused input or editor and you want a visible, human typing cadence. By default, choose the
    delay so the full string appears in about 1.5 seconds unless the specific interaction needs a
    different pace. Use `page.keyboard.press(...)` for discrete keys like `Enter`, `Escape`, arrows,
    or modifier-based edits.

- **`collaborators`.** Other signed-in browser windows that drive realtime state during the
  recording — typing indicators, incoming chat messages, another account's presence, reactions from
  someone else, etc. Keyed by an arbitrary string identifier you pick (it's only used for log
  output). Each collaborator has a `session` (the account to sign in as) and an `actions` array of
  async callbacks that receive the collaborator's Playwright `Page`.

    ```ts
    collaborators: {
        cliff: {
            session: accounts.cliffWeathers,
            actions: [
                async cliffBrowser => {
                    // The collaborator\u2019s context has `baseURL` set, so relative
                    // `page.goto("/chat/...")` works.
                    await cliffBrowser.goto(`/chat/${chat.id}`);

                    const input = cliffBrowser.getByLabel("New message");
                    await input.click();
                    await input.pressSequentially("Piling up a few asks", {delay: 40});

                    // Use `wait(ms)` from `//shared/helpers/async/wait` to pause
                    // between steps. Avoid `setTimeout` directly \u2014 keeps the style
                    // consistent with the rest of the repo.
                    await wait(1000);

                    // Server-side sends also work \u2014 the page argument is just
                    // there when you need to drive UI.
                    await chat.sendMessage(accounts.cliffWeathers, bulletedMessage);
                },
            ],
        },
    }
    ```

    **Timing model.** Within a single collaborator the `actions` array runs sequentially (action 2
    waits for action 1 to finish). Different collaborators run their arrays concurrently. There's no
    built-in delay scheduling — use `wait(ms)` when you need a pause.

    **Headless.** Collaborator browsers run in a separate headless Chromium instance — they never
    appear on screen, so they don\u2019t steal focus or fight the headed primary browser for pixels.
    Everything they do (typing, navigating, sending) still hits the real backend and shows up as
    realtime state in the primary browser you\u2019re recording.

    **When browsers open vs. when actions fire.** Every collaborator\u2019s browser is created,
    signed in, and parked on a blank page _before_ the recording starts, so no context-launch cost
    happens while the screen recorder is rolling. When collaborators are present you\u2019ll be
    prompted in the terminal to press enter _after_ you\u2019ve started your screen recorder — only
    then do the actions begin. Action errors are logged but don't abort the recording. All
    collaborator browsers close automatically when the recording ends.

    Reference implementation: demo 012 (`012_chat_message_paragraph_reactions_demo_recorder.ts`).

---

## Style & authoring tips

- The demo recordings should be incredibly precise. Pay attention to every detail. Mouse movements,
  spacing, timestamps, everything. Every pixel on screen should be considered. If there are weird
  loading glitches, you can cut them out in editing.
- Videos should feel natural when looped. It's ok if there's a jump cut when the video is looped but
  ideally you return the UI to something close to its original state (if possible) and you leave the
  mouse in a similar place as to where you started. I (@calebmer) like to put a sticky note on my
  monitor while recording to help me remember where the mouse should start/end in a recording.
- Try to keep the mouse cursor inside the recording bounds. The final video emulates a window on top
  of a desktop background. If the mouse leaves the recording frame (and doesn't show up over the
  background image) it breaks the illusion. Sometimes it's unavoidable and the mouse has to leave
  the recording but generally try keeping the mouse cursor in frame.
- Use `markdown\`...\`` template tags for all multi-line content (documents, posts, chat messages,
  instructions) — it strips the leading indentation consistently.
- Mustache-rendered mentions show up as real links. See `fictional_ambrook_demo_feed.ts` for the
  pattern.
- **Seeded content follows [`UNIVERSE.md`](../../../admin/environment/demo_space/UNIVERSE.md).**
  Characters write in their own voice, company facts match, and ongoing projects (Tables in the
  editor, Realtime Reliability, Editor Interaction Audit, Q3 customer survey, Sales enablement
  one-pager, Enterprise SSO scoping, Q4 Planning, Senior Engineer hiring, Customer case studies) are
  the default material to draw from. When a demo needs a sample document, post, chat, or task, reach
  for one of those projects first before inventing something new.
- **The `markdown` tag does not support variable interpolation** — it breaks Prettier's source code
  formatting. When you need to substitute dynamic values (e.g. mention URLs with entity IDs), use a
  placeholder string inside the `markdown` tag and `.replace()` it after:
    ```ts
    markdown`
    Check the [Q2 Update](Q2_UPDATE_MENTION_URL) for context.
    `.replace("Q2_UPDATE_MENTION_URL", `${spaceUrl}/documents/${doc.id}?mention`);
    ```
    The `admin/scenarios` code uses `Mustache.render()` for this, but Mustache is not a dependency
    of the scalable demos package — use `.replace()` instead.
- **Seeded content follows [`UNIVERSE.md`](../../../app/screenshot_tests/UNIVERSE.md).** Characters
  write in their own voice, company facts match, and ongoing projects (Tables in the editor,
  Realtime Reliability, Editor Interaction Audit, Q3 customer survey, Sales enablement one-pager,
  Enterprise SSO scoping, Q4 Planning, Senior Engineer hiring, Customer case studies) are the
  default material to draw from. When a demo needs a sample document, post, chat, or task, reach for
  one of those projects first before inventing something new.
- When seeding historical-looking content (e.g. a week-long chat backlog), set `overrideCreatedTime`
  with `@internationalized/date`'s `CalendarDateTime` + `.toDate(timeZone)` so relative timestamps
  ("2d ago") stay realistic. **Anchor dates inside the UNIVERSE.md window (Sep 8 – Oct 17, 2025),
  use `America/New_York`, and pick working hours that fit the speaker's location** (Rose/Cass/Matt
  NYC, Elle Seattle, Mason Austin, Cliff Chicago, Holly Denver).
- `runAllPromises([...])` instead of `Promise.all([...])` — repo-wide rule.

---

## Referenced scenarios

The full fictional-Ambrook scenario lives in
[`admin/scenarios/internal/fictional_ambrook_*.ts`](../../scenarios/internal/) and is a great
template when you need a rich, lived-in space. Useful entry points:

- `fictional_ambrook_demo_document.ts` — documents + public access + file attachments.
- `fictional_ambrook_demo_feed.ts` — channels, posts, post reactions, feed entries.
- `fictional_ambrook_demo_chats.ts` — long chat threads with realistic timestamps, range replies,
  and streamed bot messages.
- `fictional_ambrook_demo_inbox.ts` — notification/inbox state with retry.
- `fictional_ambrook_suggestions.ts` — canonical affinity + favorite example.
- `fictional_ambrook_demo_agents.ts` — mock-agent conversations.
- `fictional_ambrook_sprint_tasks.ts` — task hierarchies and collections.
- `fictional_ambrook_demo_channel.ts` — fleshing out a single channel.

For a full end-to-end narrative, read `landing_page_scenario.ts` and `launch_video_scenario.ts` at
the top of `admin/scenarios/`.
