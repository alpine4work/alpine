import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    ContentSchemaListItemIndentSchema,
    clampListItemIndentation,
    contentBaseProsemirrorSchemaSpec,
    createListItemParseRule,
    createProsemirrorSchemaSpec,
    toDebugStringWithIndent,
} from "~/shared/content/content_schema.js";
import {contentStructuralProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {
    checkListItemCheckedClassName,
    commentClassName,
    fileClassName,
    fileFloatClassName,
    fileFloatLeftClassName,
    fileFloatRightClassName,
    fileRowClassName,
    highlightClassNameByColor,
    listItemClassName,
    listItemIndentationVar,
    titleClassName,
} from "~/shared/content/content_styles.js";
import {HighlightColor, isHighlightColor} from "~/shared/design/highlight_color.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema} from "~/shared/schema/schema.js";

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
                checked: {
                    schema: Schema.boolean,
                    default: false,
                },
            },
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
                        "data-list-indent": indent,
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
         * Renders one or more files in content in a horizontal row. When the user
         * first adds a file to a document it'll be in a `fileRow`. A single, centered,
         * file is a `fileRow`.
         *
         * Up to three files may be rendered horizontally next to each other. File rows
         * may be stacked vertically to create an image gallery. All images in a file
         * row have the same height and we try our best to fill the entire width of the
         * document with each file row. See `layoutContentFileRow()` for more
         * information on how we layout a file row.
         */
        fileRow: {
            group: "block",
            content: "file{1,3}",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            // Allow comments on files. Comments should never appear on `fileRow`. Only on
            // `file`. We validate this is the case in
            //
            // TODO(calebmer, #files): When we define this in `content_schema.ts` this
            // `marks` definition should stay only in `document_content_schema.ts`.
            marks: "comment",
            toDOM: () => ["div", {class: fileRowClassName}, 0],
        },

        /**
         * Renders a single file floating to the left or right. Text will wrap around
         * the floating file. A useful rendering mode for files when you're writing
         * prose. You can put your file to the side of your text where it will
         * supplements the document's content instead of interrupting it.
         */
        // TODO(calebmer, #files): Floats shouldn't be allowed in `MessageContent`.
        // Only file rows should be allowed in `MessageContent`.
        fileFloat: {
            group: "block",
            content: "file",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            // Allow comments on files. Comments should never appear on `fileRow`. Only on
            // `file`. We validate this is the case in
            //
            // TODO(calebmer, #files): When we define this in `content_schema.ts` this
            // `marks` definition should stay only in `document_content_schema.ts`.
            marks: "comment",
            attrs: {
                direction: {
                    schema: Schema.enum(["left", "right"]),
                },
            },
            toDOM: node => [
                "div",
                {
                    class: `${fileFloatClassName} ${
                        node.attrs.direction === "left"
                            ? fileFloatLeftClassName
                            : fileFloatRightClassName
                    }`,
                },
                0,
            ],
        },

        /**
         * A file attached to our content. Files can be images, videos, documents
         * (e.g. PDFs or Microsoft Word docs), audio, code, and more.
         *
         * Files are never directly embedded in content. Instead they must be wrapped
         * in some container. For example, `fileRow`. The `file` node is responsible
         * for rendering file content whereas the container is responsible for figuring
         * out how to lay out the file.
         */
        file: {
            defining: true,
            isolating: true,
            selectable: true,
            // Allow comments on files.
            //
            // TODO(calebmer, #files): When we define this in `content_schema.ts` this
            // `marks` definition should stay only in `document_content_schema.ts`.
            marks: "comment",
            attrs: {
                // `fileId` is nullable so the `file` node is generatable. Otherwise
                // ProseMirror complains that `fileRow` can't be generated because it requires
                // at least one file node. `fileId: null` files will always render with an
                // error. You should always provide a `FileId`.
                fileId: {
                    schema: Schema.id<FileId>().nullable(),
                    default: null,
                },
            },
            toDOM: () => ["div", {class: fileClassName}],
        },
    },
    marks: {
        // It is important that the `comment` mark comes first so that in the DOM it
        // wraps other marks. That way when you hover the comment mark or press on it,
        // the entire comment is highlighted.

        /**
         * Users may leave comments on some range of text in a document with
         * suggestions or feedback. Leaving a comment starts a comment thread where
         * other users can join in on the conversation.
         *
         * You should not add this mark to the document without also creating the
         * referenced comment thread! The `updateDocumentContent()` function has a
         * `createCommentThread` option you may use for this purpose.
         */
        comment: {
            group: "allowedInCodeBlock",
            attrs: {
                commentThreadId: {
                    schema: Schema.id<DocumentCommentThreadId>(),
                },
            },
            inclusive: false,
            // Allow multiple comment marks to be applied to the same range of text.
            // Especially useful when you have one long comment and a smaller comment
            // within it.
            excludes: "",
            toDOM: node => [
                "mark",
                {class: commentClassName, "data-comment": node.attrs.commentThreadId},
                0,
            ],
            parseDOM: [
                {
                    tag: "mark",
                    getAttrs: node => {
                        const attrs: {[key: string]: unknown} = {};

                        // TODO(calebmer): If we are copying text with a comment from a different
                        // document, ideally we would remove the marks when pasting. So we don't try to
                        // load a comment that doesn't exist all the time. To do this we should include
                        // the document ID in `data-comment` as well.
                        if (
                            node instanceof HTMLElement &&
                            node.dataset.comment &&
                            isId<DocumentCommentThreadId>(node.dataset.comment)
                        ) {
                            attrs.commentThreadId = node.dataset.comment;
                        } else {
                            return false;
                        }

                        return attrs;
                    },
                },
            ],
        },

        ...contentBaseProsemirrorSchemaSpec.marks,

        /**
         * Gives the writer a flexible tool for annotating their content. Highlight
         * colors don't have a well defined purpose, but that means a writer can
         * assign to them whatever purpose they wish. We have a highlight color for
         * red, yellow, green, blue, and purple. We exclude orange because it is too
         * close visually to red and yellow.
         */
        highlight: {
            group: "allowedInCodeBlock",
            attrs: {
                color: {
                    schema: Schema.enum(HighlightColor),
                },
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
                        // If this is a `<mark>` for a comment then don't treat it as a highlight.
                        if (node instanceof HTMLElement && node.dataset.comment) return false;

                        const attrs: {[key: string]: unknown} = {};

                        if (
                            node instanceof HTMLElement &&
                            node.dataset.highlightColor &&
                            isHighlightColor(node.dataset.highlightColor)
                        ) {
                            attrs.color = node.dataset.highlightColor;
                        } else {
                            attrs.color = HighlightColor.Orange;
                        }

                        return attrs;
                    },
                },
            ],
        },
    },
});

export type DocumentWithoutTitleContent = Node & {readonly _DocumentWithoutTitleContent: never};

export function isDocumentWithoutTitleContent(node: Node): node is DocumentWithoutTitleContent {
    return (
        node.type.schema === DocumentWithoutTitleContentProsemirrorSchema &&
        node.type.name === "doc"
    );
}

export const DocumentWithoutTitleContentProsemirrorSchema = new ProsemirrorSchema(
    documentWithoutTitleContentProsemirrorSchemaSpec,
);

const documentWithoutTitleSchemas = createSchemaForProsemirrorSchema(
    DocumentWithoutTitleContentProsemirrorSchema,
);

export const DocumentWithoutTitleContentSchema =
    documentWithoutTitleSchemas.TopNodeType as Schema<any> as Schema<DocumentWithoutTitleContent>;

export const DocumentWithoutTitleContentStepSchema = documentWithoutTitleSchemas.createStepSchema();

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

export function createSimpleDocumentContent(text: string): DocumentContent {
    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node("doc", {}, [
            DocumentContentProsemirrorSchema.node("title", {}, []),
            DocumentContentProsemirrorSchema.node("paragraph", {}, [
                DocumentContentProsemirrorSchema.text(text),
            ]),
        ]),
    );
}

export const DocumentContentProsemirrorSchema = new ProsemirrorSchema(
    documentContentProsemirrorSchemaSpec,
);

const documentSchemas = createSchemaForProsemirrorSchema(DocumentContentProsemirrorSchema);

export const DocumentContentSchema =
    documentSchemas.TopNodeType as Schema<any> as Schema<DocumentContent>;

export const UncheckedDocumentContentSchema =
    documentSchemas.UncheckedTopNodeType as Schema<any> as Schema<Node>;

export const DocumentContentStepSchema = documentSchemas.createStepSchema();

export const emptyDocumentContent = DocumentContentProsemirrorSchema.node("doc", {}, [
    DocumentContentProsemirrorSchema.node("title"),
    DocumentContentProsemirrorSchema.node("paragraph"),
]) as DocumentContent;
