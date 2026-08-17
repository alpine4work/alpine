# Document comments

You can leave comments on [documents](documents.internal.md). When you read a document comments will
look like this.

```md
# My Document

Hello, <comment id="1">world</comment>!
```

Each `<comment>` in a document corresponds to a document comment thread. If you have
`<comment id="1">` and `<comment id="2">` then those are two different comment threads. Which you
can read with `/document/.../comments/1` and `/document/.../comments/2` respectively.

Calling the `read` tool for a `/document/.../comments/...` path will give you:

```md
Document comment thread on [My document](/document/my-document).

- [ ] Unresolved

<blockquote>

world

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

A computer science classic.

</comment>

<comment id="1" from="[Bob](/human/bob)">

I prefer foo/bar.

</comment>

End of comments.
```

We start with a link to the document the comment thread is on, then whether the thread is
`- [ ] Unresolved` or `- [x] Resolved`, then a `<blockquote>` containing the content the comment is
on, followed by the `<comment>`s in the thread.

The `<comment>`s on a `/document/.../comments/...` page (after the `<blockquote>`) use the
[messaging](messaging.internal.md) markdown format. If there are more `<comment>`s than can fit in
the `read` tool call's limit then you'll use `?after={id}` to paginate (see
[messaging](messaging.internal.md) for more information on pagination).

The first `<comment>` is the one which created the thread.

To avoid confusion, there are two ways in which a `<comment>` tag may appear across `/document/...`
and `/document/.../comments/...` pages:

- On `/document/...` pages, `<comment>` tags are used to indicate where comment threads are placed
  in a document and their `id` can be used with `/document/.../comments/{id}` to read the comment
  thread.

- On `/document/.../comments/...` pages, `<comment>` tags under the `<blockquote>` are the
  individual comments in a document comment thread.

## Updating

In addition to using the `update` tool to add new comments, you can also use the `update` tool to
change the thread from `- [ ] Unresolved` to `- [x] Resolved` and vice versa. When you resolve a
comment thread it removes the corresponding `<comment>` tags from the document.

Resolving a comment thread means the discussion is complete and any relevant actions have been taken
to address the original comment.

## Creating

You can create a new comment thread by using the `create` tool. You need the first line which says
the document the thread is on, then `- [ ] Unresolved`, then the `<blockquote>` with the text you're
commenting on, then the first `<comment>` which creates the thread (don't add `<time>`, the time is
decided by the server).

The content in `<blockquote>` should exactly match some content in the document. The skill file
[content quoting](content-quoting.internal.md) has more information on the finer details of quoting
with `<blockquote>`.
