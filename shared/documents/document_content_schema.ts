import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    AccessPolicy,
    AccessPolicySchema,
    LocalAccessPolicy,
} from "~/shared/access/access_policy.js";
import {
    ContentSchemaListItemIndentSchema,
    clampListItemIndentation,
    contentBaseProsemirrorSchemaSpec,
    createListItemParseRule,
    createProsemirrorSchemaSpec,
    toDebugStringWithIndent,
} from "~/shared/content/content_schema.js";
import {
    contentMentionProsemirrorNodeSpecs,
    createContentFileFloatProsemirrorNodeSpecs,
    createContentFileProsemirrorNodeSpecs,
} from "~/shared/content/content_schema_extra.js";
import {
    checkListItemCheckedClassName,
    commentClassName,
    highlightClassNameByColor,
    listItemClassName,
    listItemIndentationVar,
    titleClassName,
} from "~/shared/design/core/constant_class_names.js";
import {HighlightColor, isHighlightColor} from "~/shared/design/core/highlight_color.js";
import {DocumentContentCoverSchema} from "~/shared/documents/document_content_cover.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const documentWithoutTitleContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        // Importantly, we don't include the `accessPolicy` attr in the `doc` here like we
        // do in `DocumentContent`. Since this schema only represents the document
        // visually.
        ...contentBaseProsemirrorSchemaSpec.nodes,
        ...contentMentionProsemirrorNodeSpecs,
        // Allow comments on files.
        ...createContentFileProsemirrorNodeSpecs({fileMarks: "comment", withTable: true}),
        ...createContentFileFloatProsemirrorNodeSpecs({fileMarks: "comment"}),

        /**
         * List some things in either a complete or incomplete state. Modern document
         * editors typically have this as it gives you a lightweight ability to represent
         * some state of some things.
         *
         * Check lists are only available in documents since check lists are inherently
         * collaborative. They don't make as much sense in a post or comment where you
         * can't update the checked status.
         */
        checkListItem: {
            group: "block listItem tableBlock",
            content: "paragraph+",
            defining: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but there's
            // only a small number of nodes (e.g. `divider`) we actually want to let be
            // selectable.
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
            // TODO(calebmer): Test that copying a check list from a document and pasting it
            // into a post styles the list as an unordered list.
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
    },
    marks: {
        // It is important that the `comment` mark comes first so that in the DOM it wraps
        // other marks. That way when you hover the comment mark or press on it, the entire
        // comment is highlighted.

        /**
         * Users may leave comments on some range of text in a document with suggestions or
         * feedback. Leaving a comment starts a comment thread where other users can join
         * in on the conversation.
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
            // Allow multiple comment marks to be applied to the same range of text. Especially
            // useful when you have one long comment and a smaller comment within it.
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

                        // TODO(calebmer): If we are copying text with a comment from a different document,
                        // ideally we would remove the marks when pasting. So we don't try to load a
                        // comment that doesn't exist all the time. To do this we should include the
                        // document ID in `data-comment` as well.
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
         * Gives the writer a flexible tool for annotating their content. Highlight colors
         * don't have a well defined purpose, but that means a writer can assign to them
         * whatever purpose they wish. We have a highlight color for red, yellow, green,
         * blue, and purple. We exclude orange because it is too close visually to red and
         * yellow.
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
                        "data-cy-highlight": color,
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

                        const highlightColorAttribute =
                            node instanceof HTMLElement
                                ? (node.getAttribute("data-highlight-color") ??
                                  node.getAttribute("data-cy-highlight"))
                                : null;

                        if (highlightColorAttribute && isHighlightColor(highlightColorAttribute)) {
                            attrs.color = highlightColorAttribute;
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

export function assertDocumentWithoutTitleContent(node: Node): DocumentWithoutTitleContent {
    assert(isDocumentWithoutTitleContent(node));
    return node;
}

export const DocumentWithoutTitleContentProsemirrorSchema = new ProsemirrorSchema(
    documentWithoutTitleContentProsemirrorSchemaSpec,
);

const documentWithoutTitleContentSchemas = createSchemaForProsemirrorSchema(
    DocumentWithoutTitleContentProsemirrorSchema,
);

export const DocumentWithoutTitleContentSchema =
    documentWithoutTitleContentSchemas.TopNodeType as Schema<any> as Schema<DocumentWithoutTitleContent>;

export const DocumentWithoutTitleContentStepSchema =
    documentWithoutTitleContentSchemas.createStepSchema();

export const emptyDocumentWithoutTitleContent = DocumentWithoutTitleContentProsemirrorSchema.node(
    "doc",
    {},
    [DocumentWithoutTitleContentProsemirrorSchema.node("paragraph")],
) as DocumentWithoutTitleContent;

/**
 * The access policy all documents used before 2025-01-03 when we added private
 * documents. Going forward, when a document is created it has a private access
 * policy. But all documents created before 2025-01-03 are public to the space.
 *
 * IMPORTANT: Only use this as a default for legacy documents! It can be
 * catastrophic if you treat a private document as public to the space which is why
 * we label this variable as "dangerous".
 */
export const dangerousLegacyDefaultDocumentAccessPolicy: LocalAccessPolicy = {
    type: "Local",
    accountGrantById: emptyMap,
    defaultGrant: {level: "Manage", generation: 0},
    urlGrant: null,
};

const documentContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...documentWithoutTitleContentProsemirrorSchemaSpec.nodes,

        /**
         * A document includes a required title at the top.
         */
        doc: {
            content: `title ${documentWithoutTitleContentProsemirrorSchemaSpec.nodes.doc.content}`,
            attrs: {
                /**
                 * Defines who is allowed to access the document in a space and what access level
                 * they have. This property is incredibly security critical! We must take so much
                 * care to make sure only accounts with the `Manage` permission level are allowed
                 * to change the policy.
                 *
                 * The access policy, while public information, shouldn't be included in copy/paste
                 * or cmd+a (to select all) followed by delete. It must only be changed through the
                 * the sharing dialog.
                 *
                 * We include the access policy in document content so it's updated in realtime for
                 * free. If one user changes the access policy it'll be through a ProseMirror step
                 * which will be distributed to all users in realtime. The tradeoff is we need to
                 * be more careful about how it's updated. We need to make sure ProseMirror methods
                 * don't accidentally modify the access policy.
                 */
                accessPolicy: {
                    schema: AccessPolicySchema,

                    // NOTE(calebmer, 2025-01-03): Before this date, documents did not have an access
                    // policy. All accounts in a space were allowed to edit a document. Going forward,
                    // all documents will be created with a private access policy and must be
                    // explicitly shared. This default is to cover all documents created before this
                    // date. Also default public makes sense for test documents.
                    default: dangerousLegacyDefaultDocumentAccessPolicy,
                },

                /**
                 * If true then on desktop we render a "Present" button in the navigation bar next
                 * to the share button. Useful for documents written to be presentations since it
                 * provides an easy way for readers to enter presentation mode.
                 */
                hasPresentShortcut: {
                    schema: Schema.boolean,
                    default: false,
                },

                cover: {
                    schema: DocumentContentCoverSchema.nullable(),
                    default: null,
                },
            },
        },

        /**
         * Every document comes with a required title.
         *
         * The title must be plain text since we extract the title from the document and
         * render it in other places.
         *
         * Since there is only one title node and it's required, the title node also
         * contains some other attributes that are global to the document. Like the cover
         * image.
         */
        title: {
            content: "text*",
            marks: "",
            toDOM: () => ["h1", {class: titleClassName}, 0],
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

export function createSimpleDocumentContent(creatorId: AccountId, text: string): DocumentContent {
    const accessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
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

export const DocumentContentMarkSchema = documentSchemas.Mark;

export const DocumentContentStepSchema = documentSchemas.createStepSchema();

export function createEmptyDocumentContent(creatorId: AccountId) {
    const accessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    return DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
        DocumentContentProsemirrorSchema.node("title"),
        DocumentContentProsemirrorSchema.node("paragraph"),
    ]) as DocumentContent;
}

const documentWithOptionalTitleContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...documentContentProsemirrorSchemaSpec.nodes,

        // Importantly, we remove the `accessPolicy` attr from the `doc` here. Since this
        // schema only represents the document visually (similar to
        // `DocumentWithoutTitleContent`), we don't need to include access permissions for
        // the document.
        doc: {
            content: `title? ${documentWithoutTitleContentProsemirrorSchemaSpec.nodes.doc.content}`,
        },
    },
    marks: {
        ...documentContentProsemirrorSchemaSpec.marks,
    },
});

export type DocumentWithOptionalTitleContent = Node & {
    readonly _DocumentWithOptionalTitleContent: never;
};

export function isDocumentWithOptionalTitleContent(
    node: Node,
): node is DocumentWithOptionalTitleContent {
    return (
        node.type.schema === DocumentWithOptionalTitleContentProsemirrorSchema &&
        node.type.name === "doc"
    );
}

export function assertDocumentWithOptionalTitleContent(
    node: Node,
): DocumentWithOptionalTitleContent {
    assert(isDocumentWithOptionalTitleContent(node));
    return node;
}

export const DocumentWithOptionalTitleContentProsemirrorSchema = new ProsemirrorSchema(
    documentWithOptionalTitleContentProsemirrorSchemaSpec,
);

const documentWithOptionalTitleContentSchemas = createSchemaForProsemirrorSchema(
    DocumentWithOptionalTitleContentProsemirrorSchema,
);

export const DocumentWithOptionalTitleContentSchema =
    documentWithOptionalTitleContentSchemas.TopNodeType as Schema<any> as Schema<DocumentWithOptionalTitleContent>;

export const DocumentWithOptionalTitleContentStepSchema =
    documentWithOptionalTitleContentSchemas.createStepSchema();
