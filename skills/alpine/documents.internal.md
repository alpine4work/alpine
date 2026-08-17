# Documents

Alpine documents are a surface for sharing and collaborating on ideas. Documents are a simple and
flexible substrate that can be used for a wide variety of things from notes, to reports, to
presentations, to planning, to templates, and more.

A document is simply an h1 title and some [rich text content](content.internal.md)
([document content](document-content.internal.md) lists a few additional features of rich text
content in documents).

```md
# My Document

Hello, _world_!
```

You can use the `create` tool to create a new document with this syntax and you can use the `update`
tool to update any part of a document.

## Comments

To discuss content within a document people may leave comments. A comment will look like:

```md
# My Document

Hello, <comment id="1">world</comment>!
```

You can read the comment with `read` and the path `/document/.../comments/{id}` (in this case
`/document/.../comments/1`).

To create a document comment you need to use the `create` tool with a type of
`document-comment-thread`. Learn more about [document comments here](document-comments.internal.md).

## Advanced

The Alpine documents product includes some advanced features you won't use most of the time. For
instance:

- Templates
- Presentation mode
- Export

Learn more about [advanced document features here](document-advanced.internal.md).
