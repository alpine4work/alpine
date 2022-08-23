import {Node, ParseRule, Schema} from "prosemirror-model";
import {
    boldClassName,
    bulletListItemClassName,
    checkListItemCheckedClassName,
    codeClassName,
    dividerClassName,
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
    italicClassName,
    linkClassName,
    listItemClassName,
    listItemIndentation,
    orderedListItemClassName,
    paragraphClassName,
    quoteBlockClassName,
    strikeClassName,
} from "~/shared/content/content-schema.css";
import {parseRemLengthNumber} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

// TODO(calebmer): Styles for all the content things! Haven't finished:
//
// - Code block
// - Highlight

// TODO(calebmer): Consider including custom hero header images using abstract
// line art. Like from these sets:
// - https://creativemarket.com/kloroform/collections/1866986/Wires
// - https://creativemarket.com/andrewpixel/5737653-1000-Abstract-Illustration-BUNDLE (geometric shapes)

/**
 * All the possible highlight colors for the inline style.
 */
export enum HighlightColor {
    Red = "red",
    Yellow = "yellow",
    Green = "green",
    Blue = "blue",
    Purple = "purple",
}

const highlightColorSet: ReadonlySet<HighlightColor> = new Set(Object.values(HighlightColor));

function isHighlightColor(string: string): string is HighlightColor {
    return highlightColorSet.has(string as any);
}

/**
 * The maximum level of indentation for a list item.
 */
export const maxListItemIndentation = 5;

export function clampListItemIndentation(indent: unknown): number {
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
            parseDOM: [
                {tag: "p"},
                {
                    tag: "div",
                    getAttrs: node => {
                        // If this is a wrapper `<div>` with `<p>` tags inside, then we want to use our
                        // `<p>` rule to parse the DOM instead of our `<div>` rule.
                        if (!(node instanceof HTMLElement)) return {};
                        if (node.querySelector("p")) return false;
                        return {};
                    },
                },
            ],
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
            parseDOM: [
                {tag: "h1", attrs: {level: 1}},
                {tag: "h2", attrs: {level: 1}},
                {tag: "h3", attrs: {level: 2}},
                {tag: "h4", attrs: {level: 3}},
            ],
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
            parseDOM: [{tag: "blockquote"}],
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
            parseDOM: [{tag: "pre"}],
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
            parseDOM: [createListItemParseRule("ul")],
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
            parseDOM: [createListItemParseRule("ol")],
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
            parseDOM: [
                (() => {
                    const parseRule = createListItemParseRule("ul");

                    const {priority, getAttrs} = parseRule;
                    assert(priority && getAttrs);

                    return {
                        ...parseRule,
                        priority: priority + 1,
                        getAttrs: node => {
                            const attrs = getAttrs(node);
                            if (!attrs) return false;

                            if (!(node instanceof HTMLElement)) return false;

                            if (
                                node.firstElementChild &&
                                node.firstElementChild instanceof HTMLInputElement &&
                                node.firstElementChild.type === "checkbox"
                            ) {
                                return {...attrs, checked: node.firstElementChild.checked};
                            }

                            return false;
                        },
                    };
                })(),
            ],
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
            parseDOM: [{tag: "hr"}],
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
            parseDOM: [{tag: "br"}],
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
            toDOM: () => ["strong", {class: boldClassName}, 0],
            parseDOM: [
                {tag: "strong"},
                {
                    tag: "b",
                    getAttrs: node => {
                        if (typeof node === "string") return {};

                        // Google Docs appears to wrap some content in a
                        // `<b style="font-weight: normal">` element? So detect this case and don't
                        // mark content like this as bold.
                        if (node.style.fontWeight === "normal") return false;

                        return {};
                    },
                },
                {style: "font-weight=bold"},
            ],
        },

        /**
         * Another way to emphasize text. Italicized text is usually less eye
         * catching but alters the voice of some bit of text.
         */
        italic: {
            inclusive: false,
            toDOM: () => ["em", {class: italicClassName}, 0],
            parseDOM: [{tag: "em"}, {tag: "i"}, {style: "font-style=italic"}],
        },

        /**
         * Allows the writer to denote the removal of text while preserving the
         * original text for the reader. Also great for writing jokes where you put
         * two words with roughly the same meaning but different connotations and
         * strike one out which to the reader appears as you editing yourself.
         */
        strike: {
            inclusive: false,
            toDOM: () => ["del", {class: strikeClassName}, 0],
            parseDOM: [{tag: "del"}],
        },

        /**
         * Text written in a monospace font with a background of the same color as a
         * code block. For consistency with the code block allows you to reference
         * names normally written in a monospace font (code mostly).
         */
        code: {
            inclusive: false,
            toDOM: () => ["code", {class: codeClassName}, 0],
            parseDOM: [{tag: "code"}],
        },

        /**
         * Gives the writer a flexible tool for annotating their content. Highlight
         * colors don't have a well defined purpose, but that means a writer can
         * assign to them whatever purpose they wish. We have a highlight color for
         * red, yellow, green, blue, and purple. We exclude orange because it is too
         * close visually to red and yellow.
         */
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

                return ["mark", {"data-highlight-color": color}, 0];
            },
            parseDOM: [
                {
                    tag: "mark",
                    getAttrs: node => {
                        const attrs: {[key: string]: unknown} = {};

                        if (
                            node instanceof HTMLElement &&
                            node.dataset.highlightColor &&
                            isHighlightColor(node.dataset.highlightColor)
                        ) {
                            attrs.color = node.dataset.highlightColor;
                        }

                        return attrs;
                    },
                },
            ],
        },

        /**
         * This is the web! You just gotta have them links.
         */
        // TODO(calebmer): If linking to an internal URL we should load it directly
        // instead of opening in a new tab.

        // TODO(calebmer): On select or hover show URL in an overlay?
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
                        class: linkClassName,
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
            parseDOM: [
                {
                    tag: "a",
                    getAttrs: node => {
                        if (!(node instanceof HTMLAnchorElement)) return false;
                        return {url: node.href};
                    },
                },
            ],
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

function createListItemParseRule(firstListParentTagName: "ul" | "ol"): ParseRule {
    return {
        tag: "li",
        priority: 50,
        getAttrs: node => {
            if (typeof node === "string") return false;

            let parentNode = node.parentElement;
            let indent = -1;
            let isFirstListParent = true;

            while (parentNode !== null) {
                if (
                    isFirstListParent &&
                    parentNode.tagName === firstListParentTagName.toUpperCase()
                ) {
                    indent++;
                    isFirstListParent = false;
                } else if (parentNode.tagName === "UL" || parentNode.tagName === "OL") {
                    if (isFirstListParent) {
                        break;
                    }
                    indent++;
                }

                parentNode = parentNode.parentElement;
            }

            if (indent < 0) return false;
            return {indent};
        },
    };
}

/**
 * An empty doc for our content schema.
 */
export const emptyContent = ContentSchema.node("doc", {}, [ContentSchema.node("paragraph")]);
