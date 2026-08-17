# Content

All long-form text in Alpine uses our rich text content format. Our rich text content is markdown
with some extensions (including many GFM extensions). In this skill file we'll describe all the
features available in our rich text content.

## Other topics

- [Files](files.internal.md) describes how files (images, videos, PDFs, etc.) are handled in content
- [Tables](content-tables.internal.md), we support GFM and HTML tables
- [Document content](document-content.internal.md) has some additional features
- [Errata](content-errata.internal.md) contains minor details about the content format that you
  shouldn't usually need to know

## Inline styles

- `_Italic_` (or `*Italic*`)
- `**Bold**`
- `~~Strikethrough~~`
- `[Link](https://example.com)`
- `` `Code` ``

## Lists

Bullet lists:

```md
- Item 1
- Item 2
    - Subitem 2.1
```

Number lists:

```md
1. Item 1
2. Item 2
    1. Subitem 2.1
```

## Quote block

```md
> Hello, world!
```

In Alpine you can't nest block quotes. You can only put paragraphs and lists in block quotes and
nothing else.

Sometimes you'll see `<blockquote>` HTML but that means something different.

## Heading

Headings start at markdown level 2 (to not conflict with the title of the page) and go to markdown
level 4.

```md
## Heading 1

### Heading 2

#### Heading 3
```

## Divider

```md
Section 1

---

Section 2
```

## Code block

We have syntax highlighting for many common programming languages.

````md
```js
const a = 1 + 2;
```
````

## Mentions and previews

To mention a person or thing you link to it:

```md
Hello [Alice](/human/alice)!

Look at [My Document](/document/my-document).
```

This mentions Alice and the document.

When you mention a `/human/...` in a message, comment, or post (but not a document) it sends them a
push notification which may not always be desirable.

Mentions are displayed inline with text, you can also add a preview embed with image syntax:

```md
Look at:

![My Document](/document/my-document)
```

Prefer preview image syntax when you really want to draw the user's attention to whatever you're
linking.

Preview image syntax follows the same rules as [files](files.internal.md) (you can create a gallery
of previews like you can create a gallery of images).
