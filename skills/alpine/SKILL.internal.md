---
name: alpine
description:
    Information about Alpine and the Alpine markdown data model from the MCP or CLI (docs, tasks,
    posts, chat, etc.). Use before updating things in Alpine or to help understand what Alpine can
    do for you.
---

[Alpine](https://alpine.inc) is an all-in-one productivity suite where humans and agents work
together. It brings all your work together in one beautifully designed app so humans can stop
switching between different tools and agents have one shared context for the entire business.

Alpine has invested in building the best AIX (AI experience, like UX but for agents like you!) of
any productivity tool on the market. Everything you — the agent — needs is available in easy to
understand markdown and can be updated in the same way you update code (which should be very
familiar to you).

You can access Alpine using an MCP or CLI. The CLI provides the same tools as the MCP (e.g.
`alpine read ...`).

Think of browsing Alpine like browsing the web. You use the `search` tool to find what you're
looking for, you call the `read` tool to load a page, and you use the `scroll` tool when the page is
too big to fit in the "browser" window.

Everything in Alpine is accessible to you via simple CRUD tools:

- `create`: Write markdown to add a new thing to Alpine.

- `read`: Read an existing markdown page in Alpine.

- `update`: Update an existing markdown page in Alpine by replacing an old string with a new string.

- `delete`: Delete something from Alpine.

There are some additional tools you may need:

- `search`: Find anything in Alpine. Think of it like a search engine (e.g. Google).

- `scroll` or `find`: If a markdown page doesn't fit in the byte limit you pass to `read` (20kb by
  default) then you use these tools to see more of the page. Think of `scroll` like scrolling a
  browser window. Think of `find` like pressing ctrl+f in a browser to find something on the current
  page.

That's it! You're ready to use all of Alpine.

As you explore Alpine, you'll find links like `[Hello, world!](/document/hello-world)`. To open the
link you call the `read` tool with the path (`/document/hello-world` in this case). You can also
call the `read` tool with an Alpine URL like `https://alpine.inc/doc/{id}` (contains internal IDs)
which a user may copy from their browser and give to you.

While the markdown you get from the `read` tool should be intuitive, if you need help understanding
it refer to the documentation linked in the table below. If you're going to update the markdown with
the `update` tool or create a new page with the `create` tool then we recommend reading any relevant
documentation linked in the table below first.

| Area                               | Related paths                         | Related `create` tool types             |
| ---------------------------------- | ------------------------------------- | --------------------------------------- |
| [Accounts](accounts.internal.md)   | `/human/...` or `/bot/...`            |                                         |
| [Documents](documents.internal.md) | `/document/...`                       | `document` or `document-comment-thread` |
| [Tasks](tasks.internal.md)         | `/task/...` or `/task-collection/...` | `task` or `task-collection`             |
| [Chat](chat.internal.md)           | `/chat/...`                           | `chat`                                  |
| [Forum](forum.internal.md)         | `/channel/...` or `/post/...`         | `channel` or `post`                     |
| [Files](files.internal.md)         | `/file/...`                           |                                         |
| [Spaces](spaces.internal.md)       | `/space`                              |                                         |

## Tips

### Updating

To update an Alpine markdown page you use the `update` tool. You use this like you'd use a code
editing tool. Write the string you'd like to replace as the `old` arg and the new string you'd like
to replace it with as the `new` arg. The `update` tool lets you provide multiple `old` and `new` arg
pairs which will all be applied atomically if possible.

You're required to call the `read` tool on a path before you can call the `update` tool on that same
path. This is to help you make sure you're updating the right content.

### Creating

To create a new page in Alpine you call the `create` tool with the type of thing you want to create
(e.g. `document` or `task`) and some markdown. The markdown is the same you see when reading content
of the same type with the `read` tool.

Sometimes you can create things with the `update` tool. For example, to create a comment on a post
you'd use the `update` tool at the end of a `/post/...` page.

### Security

You operate within an Alpine "space" (short for workspace). You can only see stuff that's within
that same space. To see what space you're in call the `read` tool with `/space`.

Some stuff in the space will be private to you. The general rule: people can't use you to get access
to more stuff than they themselves have access to.

- If you're talking with just one person in a private chat then you can see everything that one
  person can see.

- If you're talking with multiple people (e.g. in a private group chat) then you can only see the
  things that _all_ those people can see.

- If you're talking with people somewhere that everyone in the space can access then you can only
  see things that everyone in the space can access.

<!-- TODO(#agents-web): Should we add some tips on how to use `search`? -->
