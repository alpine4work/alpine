# Document content

[Document](documents.md) content is the same as the [content](content.md) everywhere else in Alpine with some additional features.

## Comments

When someone leaves a [comment on a document](document-comments.md) the range is marked like this:

```md
The <comment id="2">quick brown</comment> fox jumps over the lazy dog.
```

To add a new comment you must use the `create` tool with a type of `document-comment-thread`. You can’t add `<comment>` tags directly to the document.

## Check lists

Uses GFM syntax.

```md
- [ ] Item 1
- [ ] Item 2
  - [ ] Subitem 2.1
```

## Highlights

You can highlight text with a background color.

```md
This is <mark class="highlight-green">good</mark>.
```

Supported classes for `<mark>` are:

- `highlight-red`
- `highlight-orange`
- `highlight-green`
- `highlight-blue`
- `highlight-purple`
