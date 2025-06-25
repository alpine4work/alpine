import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {
    DOMParser,
    Fragment,
    MarkSpec,
    Node,
    NodeSpec,
    ParseRule,
    Schema as ProsemirrorSchema,
    SchemaSpec,
    TagParseRule,
} from "prosemirror-model";
import {
    ContentCodeBlockLanguageId,
    ContentCodeBlockLanguageIdSchema,
    isContentCodeBlockLanguageId,
} from "~/shared/content/content_code_block_language_id.js";
import {ContentMention, ContentMentionSchema} from "~/shared/content/content_mention.js";
import {
    boldClassName,
    codeBlockClassName,
    codeBlockLineClassName,
    codeBlockLineContentClassName,
    codeBlockWrapperClassName,
    codeClassName,
    italicClassName,
    linkClassName,
    listItemClassName,
    listItemIndentationVar,
    orderedListItemClassName,
    paragraphClassName,
    quoteBlockClassName,
    strikeClassName,
    unorderedListItemClassName,
} from "~/shared/content/content_styles.js";
import {contentTableProsemirrorSchemaSpec} from "~/shared/content/table/content_table_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {htmlBlockTagNames} from "~/shared/helpers/html/html_block_tag_names.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {isId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

declare module "prosemirror-model" {
    // Augment `NodeType` with the undocumented `groups` array.
    interface NodeType {
        readonly groups: ReadonlyArray<string>;
    }

    interface AttributeSpec {
        // We expect every attribute to come with a schema from our schema framework.
        // `createSchemaForProsemirrorSchema()` will use this.
        schema: Schema<any>;
    }
}

/**
 * The maximum level of indentation for a list item.
 */
export const maxContentListItemIndentation = 5;

export const ContentSchemaListItemIndentSchema = Schema.integer
    .min(0)
    .max(maxContentListItemIndentation);

export function clampListItemIndentation(indent: unknown): number {
    return typeof indent === "number"
        ? clamp(0, Math.floor(indent), maxContentListItemIndentation)
        : 0;
}

export const contentCodeBlockIndentationSpaceCount = 2;

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

export type ContentProsemirrorSchema = ProsemirrorSchema<
    keyof (typeof contentBaseProsemirrorSchemaSpec)["nodes"],
    keyof (typeof contentBaseProsemirrorSchemaSpec)["marks"]
>;

export const paragraphParseRulePriority = 50;

export const paragraphParseRules = [
    {tag: "p", priority: paragraphParseRulePriority},
    {
        tag: "div",
        priority: paragraphParseRulePriority,
        getAttrs: node => {
            if (!(node instanceof HTMLElement)) return {};

            // If this is a wrapper `<div>` with `<p>` or `<div>` or `<table>` or any block
            // tags inside, then we want to use our `<p>` rule to parse the DOM instead of
            // our `<div>` rule.
            let hasBlockChildNode = false;
            for (const childNode of node.childNodes) {
                if (!(childNode instanceof HTMLElement)) continue;

                if (htmlBlockTagNames.has(childNode.tagName.toLowerCase())) {
                    hasBlockChildNode = true;
                    break;
                }
            }

            if (hasBlockChildNode) return false;
            return {};
        },
    },
] satisfies Array<ParseRule>;

export const contentBaseProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        /**
         * Document root, every ProseMirror schema requires this.
         */
        doc: {
            content: "block+",
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
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
            group: "block tableBlock",
            content: "inline*",
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            toDOM: () => ["p", {class: paragraphClassName}, 0],
            parseDOM: paragraphParseRules,
        },

        /**
         * An extended quotation. This is rendered visually with a bit of
         * indentation and a vertical ribbon. Can also be used for calling out some
         * information. Quote blocks can be arbitrarily nested so that you can quote
         * a quote of a quote.
         */
        quoteBlock: {
            group: "block tableBlock",
            content: "(paragraph | simpleListItem)+",
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            toDOM: () => ["blockquote", {class: quoteBlockClassName}, 0],
            parseDOM: [{tag: "blockquote"}],
        },

        /**
         * Text formatted with a monospace font that is horizontally scrollable
         * (instead of letting the text wrap). Useful for code, but also useful for
         * drawing ASCII diagrams since all characters are of equal width. Text in a
         * code block may not have inline formatting since in the future we'll want
         * to add syntax highlighting.
         */
        // TODO(calebmer): A couple keyboard shortcuts I think could still be useful
        // for code blocks:
        //
        // - Pressing Enter on a line with an unbalanced closing bracket should dedent
        //   the bracket to the opening bracket's line. For example, if your cursor is
        //   at `|` in a code block and you hit enter right now the newline has 4
        //   spaces of indentation when it should have 2:
        //
        //   ```
        //   class Tree {
        //     constructor(
        //       root|) {
        //       this.root = root;
        //     }
        //   }
        //   ```
        //
        // - Copy/pasting code into a code block should detect the indentation level
        //   and fix it so user doesn't have to reformat.
        //
        // - Typing a close bracket on an indented line should dedent the line. For
        //   example, if you have a code block and your cursor is `|`:
        //
        //   ```
        //   switch (c) {
        //     case "(": {
        //       break;
        //       |
        //   }
        //   ```
        //
        //   Then typing `}` should result in:
        //
        //   ```
        //   switch (c) {
        //     case "(": {
        //       break;
        //     }|
        //   }
        //   ```
        //
        // - Content editor doesn't scroll horizontally to cursor when cursor moves.
        //   Put your cursor at the end of a long code block line that causes the code
        //   block to scroll horizontally. Then press Command-Left. The cursor will
        //   move but the code block won't scroll!

        // NOTE(maximchen): we remove `code: true` from codeBlock and codeBlock
        // line because, `code: true` defaults white-space property to `pre`
        // which preserves new lines. However, we don't want to keep
        // new lines, only keep spaces.
        codeBlock: {
            group: "block tableBlock",
            content: "codeBlockLine+",
            defining: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            attrs: {
                language: {
                    schema: ContentCodeBlockLanguageIdSchema,
                    default: "text",
                },
            },
            toDOM: () => [
                "pre",
                {class: codeBlockWrapperClassName, "data-scrollbar": "false"},
                ["code", {class: codeBlockClassName}, 0],
            ],
            parseDOM: createCodeBlockParseRules(),
        },

        // The ProseMirror data model technically allows "\n" characters within text
        // content. However, we want to disallow "\n" characters in `codeBlockLine`! To
        // add new lines to a code block you must create new `codeBlockLine` nodes.
        //
        // Currently, the way we ban "\n" characters in `codeBlockLine` is a validation
        // in `getCollaborativelyUpdateContentResult()`. So it's important that
        // function comprehensively validates updated data.
        //
        // It's important we maintain that there are no "\n" characters in
        // `codeBlockLine` so:
        //
        // - Line numbers render properly
        // - Our `createContentCodeBlockNodeInput()` implementation for the code block
        //   incremental parser returns line chunks correctly
        codeBlockLine: {
            content: "text*",
            marks: "allowedInCodeBlock",
            defining: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            toDOM: () => [
                "div",
                {class: codeBlockLineClassName},
                ["div", {class: codeBlockLineContentClassName}, 0],
            ],
            // If we're in a code block, parse anything that would have been parsed as a
            // `paragraph` (`<p>` elements or `<div>` elements) as a `codeBlockLine`.
            // That way if you paste multiple lines of plain text into a code block they're
            // treated as `codeBlockLine`s.
            parseDOM: [
                ...paragraphParseRules.map(parseRule => ({
                    ...parseRule,
                    context: "codeBlock//",
                    // Make sure the priority is higher than `paragraph` parse rules.
                    priority: parseRule.priority + 50,
                })),

                // If you copy content from a `codeBlockLine` you end up with a `code` element
                // (we modified `ContentEditorDomClipboardSerializer` to output a `code`
                // element when copy/pasting) with a `data-pm-slice` attribute that tells
                // ProseMirror when pasting to wrap the element in a `codeBlock` node.
                //
                // We need to detect a copied `codeBlockLine` and parse it as a `codeBlockLine`
                // node or else we get an error because we have a wrapping `codeBlock` node
                // with incorrect child content.
                {
                    // eslint-disable-next-line string-quotes
                    tag: 'code[data-pm-slice*="\\"codeBlock\\""]',
                    priority: 100,
                },
            ],
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
            group: "block listItem simpleListItem tableBlock",
            content: "paragraph+",
            defining: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            attrs: {
                indent: {
                    schema: ContentSchemaListItemIndentSchema,
                    default: 0,
                },
            },
            toDOM: node => {
                const indent = clampListItemIndentation(node.attrs.indent);
                return [
                    "div",
                    {
                        class: classNames(listItemClassName, unorderedListItemClassName),
                        style: assignInlineVars({[listItemIndentationVar]: indent.toString()}),
                        "data-list-indent": indent,
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
            group: "block listItem simpleListItem tableBlock",
            content: "paragraph+",
            defining: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            attrs: {
                indent: {
                    schema: ContentSchemaListItemIndentSchema,
                    default: 0,
                },
            },
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
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            toDOM: () => ["br"],
            parseDOM: [{tag: "br"}],
        },

        /**
         * A mention is an inline reference to an account. Mentioning an account also
         * sends a notification to the account to get their attention.
         *
         * A mention node alone in content does not include all the data we need to
         * render it. When sending content to the client we need to load extra related
         * data. In the case of an account, their name and avatar.
         */
        mention: {
            inline: true,
            group: "inline",
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            attrs: {
                mention: {
                    schema: ContentMentionSchema,
                },
            },
            // The rendering of mentions is entirely managed with a custom renderer since
            // we need to get data from `ContentReferences`.
            toDOM: () => ["span", {}, ""],
            parseDOM: [
                {
                    tag: "span[data-cy-mention]",
                    getAttrs: node => {
                        if (!(node instanceof HTMLElement)) return false;

                        const accountId = node.getAttribute("data-cy-mention");
                        const isShort = node.getAttribute("data-cy-mention-short") !== null;

                        if (!accountId || !isId<AccountId>(accountId)) return false;

                        const mention: ContentMention = {
                            accountId,
                            isShort,
                        };

                        return {mention};
                    },
                },
            ],
        },

        ...contentTableProsemirrorSchemaSpec.nodes,
    },
    marks: {
        // NOTE(calebmer, 2022-08-13): All of our marks are `inclusive` which means
        // that typing before and after the marked text will not inherit the style. We
        // believe this to be an optimal behavior for a text editor. When you style
        // text we assume the user's intent is that the styling is final. We assume
        // that the user prefers editing the plain text around the marked text instead
        // of assuming the user prefers extending the marked text from the front
        // or end.
        //
        // Another intuition here is that if you don't use keyboard shortcuts then
        // going to the styling toolbar should always be an additive experience. The
        // editor shouldn't do a thing that makes a non-keyboard user need to go to
        // the toolbar to undo it.
        //
        // This is based on my (Caleb's) own personal nits when using rich text
        // editors. I often find myself frustrated by the inherited styles.
        //
        // NOTE(calebmer, 2023-02-28): I recently discovered that the [Bike text
        // editor][1] (and some others) have what is known as "typing affinity" or
        // "directional cursors" as a solution to this problem. When your cursor is at
        // the edge of some style it indicates which style it will use and you may use
        // the arrow keys to change that style. I like this a lot and would like us to
        // implement it someday.
        //
        // [1]: https://www.hogbaysoftware.com/posts/bike-rich-text/

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
         * This is the web! You just gotta have them links.
         */
        // NOTE(calebmer): This needs to be defined before `bold` and other styles so
        // that in the DOM `link` will wrap other styles.
        //
        // We are ok with `code` wrapping `link`. We want `link` to be the outer
        // wrapper so that hovering over build text within a link doesn't break the
        // hover link preview.
        link: {
            group: "allowedInCodeBlock",
            attrs: {
                url: {
                    schema: Schema.string,
                },
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

                        // It is important that we use `getAttribute()` here instead of `node.href`!
                        // `node.href` will run the [WhatWG URL serialization][1] algorithm which may
                        // result in a different URL than what is stored in our ProseMirror node. This
                        // confuses ProseMirror since it sees a difference between the DOM and our
                        // ProseMirror node and it ends up making unwanted changes to the document.
                        //
                        // `getAttribute()` returns exactly the value we set on the DOM and doesn't
                        // have this problem.
                        //
                        // [1]: https://url.spec.whatwg.org/#concept-url-serializer
                        return {url: node.getAttribute("href")};
                    },
                },
            ],
        },

        /**
         * Emphasize some text to let the user know it's important. Bolded text is
         * typically more eye catching than italics.
         */
        bold: {
            group: "allowedInCodeBlock",
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
            group: "allowedInCodeBlock",
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
            group: "allowedInCodeBlock",
            inclusive: false,
            toDOM: () => ["del", {class: strikeClassName}, 0],
            parseDOM: [{tag: "del"}],
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

export function createListItemParseRule(firstListParentTagName: "ul" | "ol"): TagParseRule {
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
 * Our `codeBlock` is structured with one `codeBlockLine` child node for each
 * line of code. However, this is not how code blocks are typically structured
 * in HTML. In HTML code blocks look more like this:
 *
 * ```
 * <pre><code>
 * function main() {
 *     let a = 1;
 *     let b = 1;
 *     console.log(a + b);
 * }
 * </code></pre>
 * ```
 *
 * Where newlines are separated by the `\n` character and whitespace is
 * preserved (unlike in regular HTML where whitespace is collapsed).
 *
 * To parse this standard DOM format for code blocks, we create an intermediate
 * ProseMirror schema that parses a code block _without_ `codeBlockLine`
 * children. Then we take that result, look for `\n` characters, and create a
 * `codeBlockLine` for each new line we find.
 */
function createCodeBlockParseRules(): Array<TagParseRule> {
    const CodeBlockIntermediateProsemirrorSchema = new DefaultWeakMap<
        ProsemirrorSchema,
        ProsemirrorSchema
    >(schema => {
        const schemaNodes: {[key: string]: NodeSpec} = {};
        schema.spec.nodes.forEach((key, value) => (schemaNodes[key] = value));

        const schemaMarks: {[key: string]: MarkSpec} = {};
        schema.spec.marks.forEach((key, value) => (schemaMarks[key] = value));

        return new ProsemirrorSchema({
            topNode: "codeBlock",
            nodes: {
                ...omitObject(schemaNodes, ["doc", "codeBlock", "codeBlockLine"]),

                codeBlock: {
                    // Make sure we have the same content that can go in a code block line.
                    ...assertExists(schemaNodes.codeBlockLine),

                    // White-space should not be collapsed in this intermediate schema. Newlines
                    // should be included between lines of text.
                    whitespace: "pre",

                    // Ignore `codeBlockLine`'s DOM parsing/serialization logic. We're implementing
                    // custom logic here.
                    toDOM: undefined,
                    parseDOM: undefined,
                },
            },
            marks: {
                ...omitObject(schemaMarks, [
                    // Don't parse `<code>` elements as the `code` mark. The `code` mark may not be
                    // used inside of code blocks.
                    "code",
                ]),
            },
        });
    });

    const getContent = (node: globalThis.Node, schema: ProsemirrorSchema): Fragment => {
        const parser = DOMParser.fromSchema(
            CodeBlockIntermediateProsemirrorSchema.getOrSetDefault(schema),
        );

        // Make sure `node` is a root element. `normalizeLists()` will iterate through
        // next children to determine where to put `<br>` elements and we don't want
        // that iteration to escape `node`.
        node.parentElement?.removeChild(node);

        // If the code ends with a single newline then cut out that newline. This is
        // because implicitly there will be a line break between the code block and the
        // next block after we paste.
        //
        // If there are two newlines at the end of the intermediate node then we want
        // to make sure the extra newline remains in the output.
        //
        // We cut out trailing `<br>` elements so we remove trailing newlines from
        // places like VSCode that add a trailing `<br>` but we don't remove trailing
        // newline characters from a `<pre>` element we copied from our own product.
        if (node instanceof Element) {
            const getPreviousElement = (element: Element): Element | null => {
                if (element.previousElementSibling) return element.previousElementSibling;
                if (!element.parentElement) return null;
                return getPreviousElement(element.parentElement);
            };

            let previousElement: Element | null = node;

            // Start at the last leaf child element in the `node`.
            while (previousElement.lastElementChild)
                previousElement = previousElement.lastElementChild;

            while (previousElement) {
                if (
                    htmlBlockTagNames.has(previousElement.tagName.toLowerCase()) ||
                    // Handle `<table>`s as code blocks
                    previousElement.tagName === "TR"
                ) {
                    break;
                }

                // Remove any trailing `<br>` elements like the ones generated by VSCode.
                if (previousElement.tagName === "BR") {
                    previousElement.remove();
                    break;
                }

                previousElement = getPreviousElement(previousElement);
            }
        }

        // Convert...
        //
        // ```
        // <div>
        // <div>for (let i = 0; i < n; i++) {</div>
        // <div>    console.log(i);</div>
        // <div>}</div>
        // </div>
        // ```
        //
        // ...to...
        //
        // ```
        // <div>
        // <div>for (let i = 0; i < n; i++) {<br/></div>
        // <div>    console.log(i);<br/></div>
        // <div>}<br/></div>
        // </div>
        // ```
        //
        // Since ProseMirror doesn't understand that the `<div>`s create new lines in
        // the code block but does understand `<br>` tags.
        normalizeCodeBlock(node);

        const intermediateNode = parser.parse(node, {preserveWhitespace: "full"});

        const newNodesByLine: Array<Array<Node>> = [[]];

        intermediateNode.content.forEach(intermediateChildNode => {
            if (!intermediateChildNode.isText) {
                // Convert from our intermediate schema type to the correct schema type.
                const newChildNode = schema.nodeFromJSON(intermediateChildNode.toJSON());

                newNodesByLine[newNodesByLine.length - 1]!.push(newChildNode);
                return;
            }

            const newChildNodeMarks = intermediateChildNode.marks.map(mark =>
                // Convert from our intermediate schema type to the correct schema type.
                schema.marks[mark.type.name]!.create(mark.attrs),
            );

            // ProseMirror replaces other newline characters (like `\r\n`) with `\n`.
            // https://github.com/ProseMirror/prosemirror-model/blob/d61616994c1907f6856aa2cf027a0e4944fc8023/src/from_dom.ts#L482
            const childNodeTextLines = intermediateChildNode.textContent.split("\n");

            let isFirstChildNodeTextLine = true;

            for (const childNodeTextLine of childNodeTextLines) {
                if (isFirstChildNodeTextLine) {
                    isFirstChildNodeTextLine = false;
                } else {
                    newNodesByLine.push([]);
                }

                if (childNodeTextLine.length === 0) {
                    continue;
                }

                const newChildNode = schema.text(childNodeTextLine, newChildNodeMarks);
                newNodesByLine[newNodesByLine.length - 1]!.push(newChildNode);
            }
        });

        return Fragment.from(
            newNodesByLine.map(newNodes => schema.nodes.codeBlockLine!.create(null, newNodes)),
        );
    };

    return [
        {
            context: "doc//",
            tag: "pre",
            getAttrs: (node): {language: ContentCodeBlockLanguageId} => {
                if (typeof node === "string") return {language: "text"};
                if (node.childElementCount !== 1) return {language: "text"};
                if (node.firstElementChild?.tagName !== "CODE") return {language: "text"};

                const language = node.firstElementChild.getAttribute("data-cy-language");
                if (!language) return {language: "text"};
                if (!isContentCodeBlockLanguageId(language)) return {language: "text"};

                return {language};
            },
            getContent,
        },

        {
            context: "doc//",
            // eslint-disable-next-line string-quotes
            tag: '[style*="white-space: pre"]',
            // Beat `<div>` rule for paragraphs.
            priority: 200,
            getContent,
        },

        // NOTE(calebmer): Bit of a hack, but GitHub gist has code blocks in the
        // format:
        //
        // ```
        // <table style="tab-size: 8">
        //    <tr>
        //        <td style="white-space: pre">...</td>
        //    </tr>
        //    <tr>
        //        <td style="white-space: pre">...</td>
        //    </tr>
        //    <tr>
        //        <td style="white-space: pre">...</td>
        //    </tr>
        // </table>
        // ```
        //
        // We want to parse the `table` as a code block. Given it has the `tab-size`
        // style set and only `white-space: pre` elements even support `tab-size`
        // property we consider `table` elements with `tab-size` set to be code blocks.
        {
            context: "doc//",
            // eslint-disable-next-line string-quotes
            tag: 'table[style*="tab-size"]',
            getContent,
        },
    ];
}

function normalizeCodeBlock(node: globalThis.Node) {
    const childNodeCount = node.childNodes.length;

    for (let i = 0; i < childNodeCount; i++) {
        normalizeCodeBlock(node.childNodes[i]!);
    }

    if (
        node instanceof HTMLElement &&
        (htmlBlockTagNames.has(node.tagName.toLowerCase()) ||
            // Handle `<table>`s as code blocks
            node.tagName === "TR")
    ) {
        const getNextElement = (element: Element): Element | null => {
            if (element.nextElementSibling) return element.nextElementSibling;
            if (!element.parentElement) return null;
            return getNextElement(element.parentElement);
        };

        let nextElement = getNextElement(node);
        while (nextElement) {
            if (
                htmlBlockTagNames.has(nextElement.tagName.toLowerCase()) ||
                // Handle `<table>`s as code blocks
                nextElement.tagName === "TR"
            ) {
                // NOTE(calebmer): While ProseMirror doesn't understand that block HTML tags
                // create new lines when parsing a code block, it does understand that `<br>`
                // elements create a new line. So insert a `<br>` element at the end of
                // elements that create new code block lines.
                node.appendChild(document.createElement("br"));
                break;
            }

            // There's already a `<br>` element. We don't need to add another one.
            if (nextElement.tagName === "BR") {
                break;
            }

            nextElement = getNextElement(nextElement);
        }
    }
}
