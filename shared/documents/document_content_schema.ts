import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {
    clampListItemIndentation,
    contentBaseProsemirrorSchemaSpec,
    createListItemParseRule,
    createProsemirrorSchemaSpec,
    toDebugStringWithIndent,
} from "~/shared/content/content_schema";
import {contentStructuralProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra";
import {HighlightColor, isHighlightColor} from "~/shared/design/highlight_color";
import {assert} from "~/shared/helpers/control/assert";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {
    checkListItemCheckedClassName,
    highlightClassNameByColor,
    listItemClassName,
    listItemIndentationVar,
    titleClassName,
} = contentSchemaStyles;

const documentWithoutTitleContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
        ...contentStructuralProsemirrorNodeSpecs,

        /**
         * List some things in either a complete or incomplete state. Modern
         * document editors typically have this as it gives you a lightweight
         * ability to represent some state of some things.
         *
         * Check lists are only available in documents since check lists are inherently
         * collaborative. They don't make as much sense in a post or comment where you
         * can't update the checked status.
         */
        checkListItem: {
            group: "block listItem",
            content: "paragraph+",
            attrs: {
                indent: {default: 0},
                checked: {default: false},
            },
            defining: true,
            // TODO(calebmer): Test that copying a check list from a document and pasting
            // it into a post styles the list as an unordered list.
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

export const DocumentWithoutTitleContentStepSchema = Schema.unknown.transform<Step>({
    serialize: step => step.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = Step.fromJSON(DocumentWithoutTitleContentProsemirrorSchema, unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid document content step");
        }

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

export function assertDocumentContent(node: Node): DocumentContent {
    assert(isDocumentContent(node));
    return node;
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

export const DocumentContentStepSchema = Schema.unknown.transform<Step>({
    serialize: step => step.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = Step.fromJSON(DocumentContentProsemirrorSchema, unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid document content step");
        }

        return content;
    },
});

export const emptyDocumentContent = DocumentContentProsemirrorSchema.node("doc", {}, [
    DocumentContentProsemirrorSchema.node("title"),
    DocumentContentProsemirrorSchema.node("paragraph"),
]) as DocumentContent;
