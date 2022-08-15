import {Node, Schema} from "prosemirror-model";
import {
    bulletListItemClassName,
    checkListItemCheckedClassName,
    dividerClassName,
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
    listItemClassName,
    listItemIndentation,
    orderedListItemClassName,
    paragraphClassName,
    quoteBlockClassName,
} from "~/shared/content/content-schema.css";
import {parseRemLengthNumber} from "~/shared/design/spacing";

// TODO(calebmer): Handle paste with `fromDOM`! Change all our snapshot tests to
// also make sure copy/paste is an exact copy.

// TODO(calebmer): Styles for all the content things! Haven't finished:
//
// - Heading (no font?)
// - Code block
// - Unordered list
// - Ordered list
// - Check list
// - Strike
// - Inline code
// - Highlight
// - Link
// - Quote block
// - Divider

// TODO(calebmer): Consider getting rid of `<h3>`

// TODO(calebmer): "shift+enter" should always have the exact same behavior as
// "enter" to have an alternative in contexts where "enter" sends a message. To
// add a line break you need to use "alt+enter".

// TODO(calebmer): Consider including custom hero header images using abstract
// line art. Like from these sets:
// - https://creativemarket.com/kloroform/collections/1866986/Wires
// - https://creativemarket.com/andrewpixel/5737653-1000-Abstract-Illustration-BUNDLE (geometric shapes)

/**
 * All the possible highlight colors for the inline style.
 */
export enum HighlightColor {
    Red = "Red",
    Yellow = "Yellow",
    Green = "Green",
    Blue = "Blue",
    Purple = "Purple",
}

const highlightColorSet: ReadonlySet<HighlightColor> = new Set(Object.values(HighlightColor));

function isHighlightColor(string: string): string is HighlightColor {
    return highlightColorSet.has(string as any);
}

/**
 * The maximum level of indentation for a list item.
 */
export const maxListItemIndentation = 5;

function clampListItemIndentation(indent: unknown): number {
    return typeof indent === "number"
        ? Math.min(Math.max(0, Math.floor(indent)), maxListItemIndentation)
        : 0;
}

function getListItemIndentationStyle(indentation: number): string {
    return `margin-left:${
        parseRemLengthNumber(listItemIndentation) * indentation
    }rem;padding-left:${listItemIndentation}`;
}

const allowedLinkProtocols: ReadonlySet<string> = new Set(["http", "https"]);

/**
 * Does the URL string start with an allowed protocol?
 */
export function startsWithAllowedProtocol(url: string) {
    for (const protocol of allowedLinkProtocols) {
        if (url.startsWith(`${protocol}://`)) {
            return true;
        }
    }
    return false;
}

/**
 * A ProseMirror document schema. See the [ProseMirror guide on schemas][1] for
 * an explanation of this format. See [`prosemirror-schema-basic`][2] for an
 * example of a basic schema. See [`prosemirror-schema-list`][3] for an example
 * of adding list nodes to a schema.
 *
 * [1]: https://prosemirror.net/docs/guide/#schema
 * [2]: https://github.com/ProseMirror/prosemirror-schema-basic/blob/3d626fd16e0c4eb5a448ec585509494243ef55b3/src/schema-basic.js
 * [3]: https://github.com/ProseMirror/prosemirror-schema-list/blob/7b082efb983c7ab61b6f56135cbf04ce8f41b6fe/src/schema-list.js
 */
export const ContentSchema = new Schema({
    nodes: {
        /**
         * Document root, every ProseMirror schema requires this.
         */
        doc: {
            content: "block+",
        },

        /**
         * Generic inline text, every ProseMirror schema requires this.
         */
        text: {
            inline: true,
            group: "inline",
        },

        /**
         * Of course you need a way to write plain text.
         */
        paragraph: {
            group: "block",
            content: "inline*",
            toDOM: () => ["p", {class: paragraphClassName}, 0],
        },

        /*
         * Crucial for adding structure to the document. Can be extended in the
         * future with an outline feature.
         *
         * Can only be levels 1, 2, and 3.
         *
         * The element used for a heading is its level plus 1. For example, a
         * heading with level 1 will use an `<h2>` instead of an `<h1>`. This is
         * because our support for titles usually lives outside content (e.g.
         * tasks). This also prevents users from confusing screen readers by
         * creating a bunch of level 1 headings.
         */
        heading: {
            group: "block",
            content: "inline*",
            attrs: {
                level: {default: 1},
            },
            toDOM: node => {
                const unknownLevel: unknown = node.attrs.level;
                const level =
                    typeof unknownLevel === "number"
                        ? Math.max(Math.min(3, Math.floor(unknownLevel)), 1)
                        : 1;
                return [
                    `h${level + 1}`,
                    {
                        class:
                            level === 3
                                ? headingLevel3ClassName
                                : level === 2
                                ? headingLevel2ClassName
                                : headingLevel1ClassName,
                    },
                    0,
                ];
            },
        },

        /**
         * An extended quotation. This is rendered visually with a bit of
         * indentation and a vertical ribbon. Can also be used for calling out some
         * information. Quote blocks can be arbitrarily nested so that you can quote
         * a quote of a quote.
         */
        quoteBlock: {
            group: "block",
            content: "(paragraph | simpleListItem)+",
            toDOM: () => [`blockquote`, {class: quoteBlockClassName}, 0],
        },

        /**
         * Text formatted with a monospace font that is horizontally scrollable
         * (instead of letting the text wrap). Useful for code, but also useful for
         * drawing ASCII diagrams since all characters are of equal width. Text in a
         * code block may not have inline formatting since in the future we'll want
         * to add syntax highlighting.
         */
        // TODO(calebmer): Syntax highlighting for code. Allow user to pick the
        // language.

        // TODO(calebmer): Some nice keyboard shortcuts for code editing. For
        // example, "newline" on a line with indentation should preserve that
        // indentation. Another example, typing balanced characters (`(`, `{`, `[`)
        // should add the other side.
        codeBlock: {
            group: "block",
            content: "text*",
            marks: "",
            defining: true,
            code: true,
            toDOM: () => ["pre", ["code", 0]],
        },

        // Welcome to the list items! You'll notice that we structure them
        // differently than ProseMirror recommends. Instead of the standard nested
        // `<ul>`/`<li>` HTML structure (which ProseMirror fully supports) we choose
        // to not nest list items and use plain `<div>`s. When rendering documents
        // we will use semantic HTML, but for editing we use `<div>`s.
        //
        // We started by trying to use `<ul>`/`<li>` but found that the there were
        // so many edge cases and the editing experience could be confusing at
        // times. Sometimes dedenting a list item would dedent all its children!
        // Sometimes you couldn't delete a bullet because it has children list items
        // attached.
        //
        // So to simplify code and the editing experience we switched to individual
        // list items with an indentation attribute. What we lose is semantic HTML
        // list elements while editing and we make it possible to create a document
        // in a weird state. (e.g. Floating list items with indentation.) We find
        // this to be an acceptable tradeoff.
        //
        // It appears that many text editors go in this direction. For example,
        // Dropbox Paper.

        // TODO(calebmer): Render lists with `<ul>`/`<li>` when read-only.

        // TODO(calebmer): Copy lists as `<ul>`/`<li>` if possible.

        // TODO(calebmer): Handle for drag-to-reorder with list items.

        /**
         * List some things in no particular order with proper indentation.
         */
        unorderedListItem: {
            group: "block listItem simpleListItem",
            content: "paragraph+",
            attrs: {
                indent: {default: 0},
            },
            defining: true,
            toDOM: node => {
                const indent = clampListItemIndentation(node.attrs.indent);
                return [
                    "div",
                    {
                        class: `${listItemClassName} ${bulletListItemClassName}`,
                        style: getListItemIndentationStyle(indent),
                    },
                    0,
                ];
            },
            toDebugString: toDebugStringWithIndent,
        },

        /**
         * List some things with a counter with proper indentation.
         */
        orderedListItem: {
            group: "block listItem simpleListItem",
            content: "paragraph+",
            attrs: {
                indent: {default: 0},
            },
            defining: true,
            toDOM: node => {
                const indent = clampListItemIndentation(node.attrs.indent);
                return [
                    "div",
                    {
                        class: `${listItemClassName} ${orderedListItemClassName}`,
                        style: getListItemIndentationStyle(indent),
                        "data-list-indent": indent,
                        // Should be overridden by a custom `NodeView`.
                        "data-list-number": 0,
                    },
                    0,
                ];
            },
            toDebugString: toDebugStringWithIndent,
        },

        /**
         * List some things in either a complete or incomplete state. Modern
         * document editors typically have this as it gives you a lightweight
         * ability to represent some state of some things.
         */
        checkListItem: {
            group: "block listItem",
            content: "paragraph+",
            attrs: {
                indent: {default: 0},
                checked: {default: false},
            },
            defining: true,
            toDOM: node => {
                const indent = clampListItemIndentation(node.attrs.indent);
                return [
                    "div",
                    {
                        class: node.attrs.checked
                            ? `${listItemClassName} ${checkListItemCheckedClassName}`
                            : listItemClassName,
                        style: getListItemIndentationStyle(indent),
                    },
                    0,
                ];
            },
            toDebugString: toDebugStringWithIndent,
        },

        /**
         * Also known as a horizontal rule. Another way to organize documents
         * alongside headers. Allows the writer to specify an unnamed break in
         * content.
         */
        divider: {
            group: "block",
            toDOM: () => ["hr", {class: dividerClassName}],
        },

        /**
         * A hard line break in the document. Provides just a little bit more
         * flexibility for document spacing. For example, if you want two lines
         * without margin between them (which you'd get with a paragraph) you'd use
         * a hard break.
         */
        break: {
            inline: true,
            group: "inline",
            selectable: false,
            toDOM: () => ["br"],
        },
    },
    marks: {
        // All of our marks are `inclusive` which means that typing before and after
        // the marked text will not inherit the style. We believe this to be an
        // optimal behavior for a text editor. When you style text we assume the
        // user's intent is that the styling is final. We assume that the user
        // prefers editing the plain text around the marked text instead of assuming
        // the user prefers extending the marked text from the front or end.
        //
        // Another intuition here is that if you don't use keyboard shortcuts then
        // going to the styling toolbar should always be an additive experience. The
        // editor shouldn't do a thing that makes a non-keyboard user need to go to
        // the toolbar to undo it.
        //
        // This is based on my (Caleb's) own personal nits when using rich text
        // editors. I often find myself frustrated by the inherited styles.

        /**
         * Emphasize some text to let the user know it's important. Bolded text is
         * typically more eye catching than italics.
         */
        bold: {
            inclusive: false,
            toDOM: () => ["strong", 0],
        },

        /**
         * Another way to emphasize text. Italicized text is usually less eye
         * catching but alters the voice of some bit of text.
         */
        italic: {
            inclusive: false,
            toDOM: () => ["em", 0],
        },

        /**
         * Allows the writer to denote the removal of text while preserving the
         * original text for the reader. Also great for writing jokes where you put
         * two words with roughly the same meaning but different connotations and
         * strike one out which to the reader appears as you editing yourself.
         */
        // TODO(calebmer): Screen readers don't announce deleted content so we
        // need custom accessibility support. See:
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/del#Accessibility_concerns
        strike: {
            inclusive: false,
            toDOM: () => ["del", 0],
        },

        /**
         * Text written in a monospace font with a background of the same color as a
         * code block. For consistency with the code block allows you to reference
         * names normally written in a monospace font (code mostly).
         */
        code: {
            inclusive: false,
            toDOM: () => ["code", 0],
        },

        /**
         * Gives the writer a flexible tool for annotating their content. Highlight
         * colors don't have a well defined purpose, but that means a writer can
         * assign to them whatever purpose they wish. We have a highlight color for
         * red, yellow, green, blue, and purple. We exclude orange because it is too
         * close visually to red and yellow.
         */
        // TODO(calebmer): Screen readers don't announce marked content so we
        // need custom accessibility support. See:
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/mark#Accessibility_concerns
        highlight: {
            attrs: {
                color: {},
            },
            inclusive: false,
            toDOM: node => {
                const unknownColor: unknown = node.attrs.color;
                const color: HighlightColor =
                    typeof unknownColor === "string" && isHighlightColor(unknownColor)
                        ? unknownColor
                        : HighlightColor.Yellow;

                // TODO(calebmer): Do something with the highlight color! Also test
                // that logic.
                //
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                color;

                return ["mark", 0];
            },
        },

        /**
         * This is the web! You just gotta have them links.
         */
        // TODO(calebmer): If linking to an internal URL we should load it directly
        // instead of opening in a new tab.
        link: {
            attrs: {
                url: {},
            },
            inclusive: false,
            toDOM: node => {
                const unknownUrl: unknown = node.attrs.url;

                // We only allow linking to URLs with an HTTP or HTTPS scheme. That way
                // we avoid XSS vulnerabilities with URLs that look like
                // `javascript:alert('XSS')`.
                const url =
                    typeof unknownUrl === "string" && startsWithAllowedProtocol(unknownUrl)
                        ? unknownUrl
                        : "about:blank#blocked";

                return [
                    "a",
                    {
                        // Open link in a new tab.
                        target: "_blank",
                        // Important security measure. See:
                        // https://mathiasbynens.github.io/rel-noopener
                        rel: "noopener noreferrer",
                        href: url,
                    },
                    0,
                ];
            },
        },
    },
});

function toDebugStringWithIndent(node: Node) {
    const args = [];

    if (node.attrs.indent) {
        args.push(`indent: ${JSON.stringify(node.attrs.indent)}`);
    }

    node.forEach(childNode => args.push(childNode.toString()));

    return args.length === 0 ? `${node.type.name}` : `${node.type.name}(${args.join(", ")})`;
}

/**
 * An empty doc for our content schema.
 */
export const emptyContent = ContentSchema.node("doc", {}, [ContentSchema.node("paragraph")]);
