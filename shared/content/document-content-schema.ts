import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    clampListItemIndentation,
    contentBaseProsemirrorSchemaSpec,
    createListItemParseRule,
    createProsemirrorSchemaSpec,
    toDebugStringWithIndent,
} from "~/shared/content/content-schema";
import {
    checkListItemCheckedClassName,
    dividerClassName,
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
    highlightClassNameByColor,
    listItemClassName,
    listItemIndentationVar,
    titleClassName,
} from "~/shared/content/content-schema.css";
import {HighlightColor, isHighlightColor} from "~/shared/content/highlight-color";
import {assert} from "~/shared/helpers/control/assert";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

const documentWithoutTitleContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,

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
                {tag: "h1", priority: 50, attrs: {level: 1}},
                {tag: "h2", priority: 50, attrs: {level: 1}},
                {tag: "h3", priority: 50, attrs: {level: 2}},
                {tag: "h4", priority: 50, attrs: {level: 3}},
                {tag: "h5", priority: 50, attrs: {level: 3}},
                {tag: "h6", priority: 50, attrs: {level: 3}},
            ],
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
                        class: classNames(listItemClassName, {
                            [checkListItemCheckedClassName]: node.attrs.checked,
                        }),
                        style: assignInlineVars({[listItemIndentationVar]: indent.toString()}),
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
    },
    marks: {
        ...contentBaseProsemirrorSchemaSpec.marks,

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
                        : HighlightColor.Orange;

                return [
                    "mark",
                    {
                        class: highlightClassNameByColor[color],
                        "data-highlight-color": color,
                    },
                    0,
                ];
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
    },
});

export type DocumentWithoutTitleContent = Node & {_DocumentWithoutTitleContent: never};

export function isDocumentWithoutTitleContent(node: Node): node is DocumentWithoutTitleContent {
    return (
        node.type.schema === DocumentWithoutTitleContentProsemirrorSchema &&
        node.type.name === "doc"
    );
}

export const DocumentWithoutTitleContentProsemirrorSchema = new ProsemirrorSchema(
    documentWithoutTitleContentProsemirrorSchemaSpec,
);

export const DocumentWithoutTitleContentSchema =
    Schema.unknown.transform<DocumentWithoutTitleContent>({
        serialize: content => content.toJSON(),
        deserialize: unknownValue => {
            let content;
            try {
                content = DocumentWithoutTitleContentProsemirrorSchema.nodeFromJSON(unknownValue);
            } catch {
                throw new SchemaDeserializationError("Invalid document content");
            }

            if (!isDocumentWithoutTitleContent(content))
                throw new SchemaDeserializationError('Invalid document content"');

            return content;
        },
    });

export const emptyDocumentWithoutTitleContent = DocumentWithoutTitleContentProsemirrorSchema.node(
    "doc",
    {},
    [DocumentWithoutTitleContentProsemirrorSchema.node("paragraph")],
) as DocumentWithoutTitleContent;

const documentContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...documentWithoutTitleContentProsemirrorSchemaSpec.nodes,

        /**
         * A document includes a required title at the top.
         */
        doc: {
            content: `title ${documentWithoutTitleContentProsemirrorSchemaSpec.nodes.doc.content}`,
        },

        /**
         * Every document comes with a required title.
         *
         * The title must be plain text since we extract the title from the
         * document and render it in other places.
         *
         * Since there is only one title node and it's required, the title node also
         * contains some other attributes that are global to the document. Like the
         * cover image.
         */
        title: {
            content: "text*",
            marks: "",
            toDOM: () => ["h1", {class: titleClassName}, 0],
            // Try to parse as a `heading`. If we can't (because it's the first position in
            // a document) then parse as a title.
            parseDOM: [
                {tag: "p", priority: 40},
                {tag: "div", priority: 40},
                {tag: "h1", priority: 40},
                {tag: "h2", priority: 40},
                {tag: "h3", priority: 40},
                {tag: "h4", priority: 40},
                {tag: "h5", priority: 40},
                {tag: "h6", priority: 40},
            ],
        },
    },
    marks: {
        ...documentWithoutTitleContentProsemirrorSchemaSpec.marks,
    },
});

export type DocumentContent = Node & {_DocumentContent: never};

export function isDocumentContent(node: Node): node is DocumentContent {
    return node.type.schema === DocumentContentProsemirrorSchema && node.type.name === "doc";
}

export const DocumentContentProsemirrorSchema = new ProsemirrorSchema(
    documentContentProsemirrorSchemaSpec,
);

export const DocumentContentSchema = Schema.unknown.transform<DocumentContent>({
    serialize: content => content.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = DocumentContentProsemirrorSchema.nodeFromJSON(unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid document content");
        }

        if (!isDocumentContent(content))
            throw new SchemaDeserializationError('Invalid document content"');

        return content;
    },
});

export const emptyDocumentContent = DocumentContentProsemirrorSchema.node("doc", {}, [
    DocumentContentProsemirrorSchema.node("title"),
    DocumentContentProsemirrorSchema.node("paragraph"),
]) as DocumentContent;
