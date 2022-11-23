import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Node, ParseRule, Schema, SchemaSpec} from "prosemirror-model";
import {clamp} from "~/shared/helpers/number/clamp";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {
    boldClassName,
    bulletListItemClassName,
    codeClassName,
    italicClassName,
    linkClassName,
    listItemClassName,
    listItemIndentationVar,
    orderedListItemClassName,
    paragraphClassName,
    quoteBlockClassName,
    strikeClassName,
} = contentSchemaStyles;

/**
 * The maximum level of indentation for a list item.
 */
export const maxListItemIndentation = 5;

export function clampListItemIndentation(indent: unknown): number {
    return typeof indent === "number" ? clamp(0, Math.floor(indent), maxListItemIndentation) : 0;
}

/**
 * TypeScript convenience function for creating a `SchemaSpec`. Forces us to
 * adhere to the `SchemaSpec` format while allowing the return type to be an
 * instance of `SchemaSpec`. (So node keys are preserved, for instance.)
 */
export function createProsemirrorSchemaSpec<Schema extends SchemaSpec<string, string>>(
    schema: Schema,
): Schema {
    return schema;
}

export type ContentProsemirrorSchema = Schema<
    keyof typeof contentBaseProsemirrorSchemaSpec["nodes"],
    keyof typeof contentBaseProsemirrorSchemaSpec["marks"]
>;

export const contentBaseProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
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
                {tag: "p", priority: 50},
                {
                    tag: "div",
                    priority: 50,
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
        // TODO(calebmer): Implement styling for code blocks.

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
                        class: classNames(listItemClassName, bulletListItemClassName),
                        style: assignInlineVars({[listItemIndentationVar]: indent.toString()}),
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
                        class: classNames(listItemClassName, orderedListItemClassName),
                        style: assignInlineVars({[listItemIndentationVar]: indent.toString()}),
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
         * Text written in a monospace font with a background of the same color as a
         * code block. For consistency with the code block allows you to reference
         * names normally written in a monospace font (code mostly).
         */
        // NOTE(calebmer): This needs to be defined before `bold` and other styles so
        // that in the DOM `code` will wrap other styles.
        code: {
            inclusive: false,
            toDOM: () => ["code", {class: codeClassName}, 0],
            parseDOM: [{tag: "code"}],
        },

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
                    typeof unknownUrl === "string" && startsWithSafeUrlProtocol(unknownUrl)
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

export function toDebugStringWithIndent(node: Node) {
    const args = [];

    if (node.attrs.indent) {
        args.push(`indent: ${JSON.stringify(node.attrs.indent)}`);
    }

    node.forEach(childNode => args.push(childNode.toString()));

    return args.length === 0 ? `${node.type.name}` : `${node.type.name}(${args.join(", ")})`;
}

export function createListItemParseRule(firstListParentTagName: "ul" | "ol"): ParseRule {
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
