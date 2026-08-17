# Content quoting

In [messaging](messaging.md) and [document comment threads](document-comments.md) there are `<blockquote>`s which contain quoted content from another message and a document respectively. What’s special about a `<blockquote>`s quoted content is that it’s linked. If the underlying content changes and you call `read` again then the content in `<blockquote>` will change.

On the server `<blockquote>` is backed by a start and end position within a certain piece of content. Not by the content itself. Which is why the content inside will update live.

However, the start/end positions are in an internal format we spare you from needing to know. Instead when writing a `<blockquote>` you’ll perfectly recreate existing content and we’ll translate that into the appropriate internal start/end position.

For example, in the text:

```md
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
```

You can quote the first part of the sentence with:

```md
<blockquote>

Lorem ipsum dolor sit amet

</blockquote>
```

(Make sure to include a `\n\n` after the `<blockquote>` and before the `</blockquote>` or we can’t parse the content within properly due to a quirk in markdown.)

The way our content matcher works is it searches a haystack (the message/document you’re matching) with a needle (the content in `<blockquote>`) character by character until we find a full match. However, we match the _underlying logical text characters after parsing the markdown_ not the literal markdown characters.

So for example if you have:

```md
_Lorem ipsum dolor sit amet_, consectetur adipiscing elit.
```

…and you wanted to quote “Lorem ipsum” you’d write:

```md
<blockquote>

_Lorem ipsum_

</blockquote>
```

…or:

```md
<blockquote>

Lorem ipsum

</blockquote>
```

…and _not_ `_Lorem ipsum` (without a trailing `_`).

The underlying logical text characters are “Lorem ipsum”. After we parse the markdown we detect that due to `_` characters italic styles are applied to “Lorem ipsum dolor sit amet”. So when we compare underlying logical text we compare an italicized “L”, italicized “o”, italicized “r”, etc.

`Lorem ipsum` also. When we parse `Lorem ipsum` we have a plain “L”, plain “o”, plain “r”, etc. and when we parse `_Lorem ipsum_` we have an italicized “L”, italicized “o”, italicized “r”, etc. The rule is the styles of each character in the needle must be a subset of the styles in the haystack. So `**Lorem ipsum**` would not work because then we have a bold “L”, bold “o”, bold “r”, etc. and the “bold” style is not a subset of the “italicized” style. If needle was `_foo_` and the haystack was `_**foobar**_` then `_foo_` would match because italic is a subset of bold + italic.

Special case: mentions like `[Alice](/human/alice)` are considered one complete “character”. Links like `[example](https://example.com)` are expanded to link “e”, link “x”, link “a”, etc.

This subset matching logic also applies to block styles. So for example quote blocks:

```md
> Lorem ipsum dolor sit amet, consectetur adipiscing elit.
```

…and list items:

```md
- Lorem ipsum dolor sit amet, consectetur adipiscing elit.
```

…are matched by:

```md
<blockquote>

Lorem ipsum

</blockquote>
```

…or:

```md
<blockquote>

> Lorem ipsum

</blockquote>
```

…and:

```md
<blockquote>

- Lorem ipsum

</blockquote>
```

…respectively.

You should be able to apply these same basic ideas to figure out how to match content in tables and code blocks or content with link styles or a mention.
