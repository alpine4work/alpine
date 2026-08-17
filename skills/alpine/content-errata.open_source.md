# Content errata

Minor details about the [rich text content](content.md) format that you shouldn’t usually need to know to work in Alpine. But if you’re observing something weird, then this skill file should cover it.

## Breaks

A newline between two bits of text (e.g. `foo\nbar`), or:

```md
foo\
bar
```

…or:

```md
foo<br />bar
```

Then there’s a hard break between “foo” and “bar”.

If you see:

```md
foo

bar
```

…then “foo” and “bar” are on separate paragraphs. Paragraphs are rendered with some margin in between whereas hard breaks put the content on separate lines but doesn’t render any additional margin between the lines.

## Empty paragraphs

An empty paragraph is printed as `<p></p>`. You may see this:

```md
foo

<p></p>

bar
```

…or this:

```md
- <p></p>
```

If the user leaves an empty paragraph then we need to represent that in markdown somehow. So we insert an empty `<p>` tag. It’s safe to remove `<p></p>` and replace it with some content.

## Phantom list items

Rare edge case, the editor can get into a state where a user has an intended list item with no parent. These are called “phantom list items” and are rendered like this:

```md
- - List item
```

(One level of indentation.)

```md
- - - - List item
```

(Three levels of indentation.)

Don’t create new phantom list items, but now you know what it means if you see one.

## HTML syntax

HTML syntax will work for some features.

- `<em>Italic</em>` or `<i>Italic</i>`
- `<strong>Bold</strong>` or `<b>Bold</b>`
- `<del>Strikethrough</del>`
- `<a href="https://example.com">Link</a>`
- `<hr />` for dividers
- `<pre><code class="language-javascript">...</code></pre>` for code blocks

Sometimes we fall back to HTML when we can’t use markdown syntax.

One important case is when you have inline styles within a code block.

```md
<pre>
<code class="language-javascript">
// Check <a href="https://example.com">this</a> out
const a = 1 + 2;
</code>
</pre>
```

Here the `<a>` in the comment is treated as an actual link! The user will see “this” rendered as a clickable link instead of the literal `<a>` text. In these two examples `[this](https://example.com)` is displayed as literal text and not a clickable link.

```md
<pre>
<code class="language-javascript">
// Check [this](https://example.com) out
const a = 1 + 2;
</code>
</pre>
```

````md
```js
// Check [this](https://example.com) out
const a = 1 + 2;
```
````
