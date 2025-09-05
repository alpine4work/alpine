import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";

/**
 * Name of all node types for any kind of content in our system.
 *
 * May include node names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentNodeTypeName = keyof typeof contentNodeTypeNames;

export const contentNodeTypeNames = {
    doc: true,
    text: true,
    paragraph: true,
    quoteBlock: true,
    codeBlock: true,
    codeBlockLine: true,
    unorderedListItem: true,
    orderedListItem: true,
    checkListItem: true,
    break: true,
    heading: true,
    divider: true,
    mention: true,
    title: true,
    fileRow: true,
    fileFloat: true,
    file: true,
    table: true,
    tableRow: true,
    tableCell: true,
    fileRowTable: true,
};

/**
 * Name of all inline node types for any kind of content in our system.
 *
 * May include node names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentInlineNodeTypeName = keyof typeof contentInlineNodeTypeNames;

export const contentInlineNodeTypeNames = {
    text: true,
    break: true,
    mention: true,
};

/**
 * Name of all textblock node types for any kind of content in our system.
 *
 * May include node names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentTextblockNodeTypeName = keyof typeof contentTextblockNodeTypeNames;

export const contentTextblockNodeTypeNames = {
    paragraph: true,
    codeBlockLine: true,
    heading: true,
    title: true,
};

/**
 * Name of all block node types for any kind of content in our system. (Blocks
 * are nodes that live at the root of a `doc`.)
 *
 * May include node names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentBlockNodeTypeName = keyof typeof contentBlockNodeTypeNames;

export const contentBlockNodeTypeNames = {
    paragraph: true,
    quoteBlock: true,
    codeBlock: true,
    unorderedListItem: true,
    orderedListItem: true,
    checkListItem: true,
    heading: true,
    divider: true,
    fileRow: true,
    fileFloat: true,
    fileRowTable: true,
    table: true,
};

/**
 * Name of all mark types for any kind of content in our system.
 *
 * May include mark names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentMarkTypeName = keyof typeof contentMarkTypeNames;

export const contentMarkTypeNames = {
    italic: true,
    bold: true,
    code: true,
    link: true,
    strike: true,
    comment: true,
    highlight: true,
};

/**
 * Name of all list item node types for any kind of content in our system.
 *
 * May include nodes names that don't exist in the `shared/content` package but
 * do exist elsewhere (like `shared/documents`).
 *
 * Useful for writing code that operates on any kind of content.
 */
export type ContentListItemNodeTypeName = keyof typeof contentListItemNodeTypeNames;

export const contentListItemNodeTypeNames = {
    unorderedListItem: true,
    orderedListItem: true,
    checkListItem: true,
};

/**
 * Make sure that our type names cover everything in the ProseMirror schema.
 */
export function assertContentTypeNamesCoverProsemirrorSchema(schema: ProsemirrorSchema) {
    for (const type of Object.values(schema.nodes)) {
        assert(hasOwnProperty(contentNodeTypeNames, type.name));

        if (type.isInline) {
            assert(hasOwnProperty(contentInlineNodeTypeNames, type.name));
        }

        if (type.isTextblock) {
            assert(hasOwnProperty(contentTextblockNodeTypeNames, type.name));
        }

        if (type.groups.includes("block") || type.groups.includes("tableBlock")) {
            assert(hasOwnProperty(contentBlockNodeTypeNames, type.name));
        }

        if (type.groups.includes("listItem")) {
            assert(hasOwnProperty(contentListItemNodeTypeNames, type.name));
        }
    }

    for (const type of Object.values(schema.marks)) {
        assert(hasOwnProperty(contentMarkTypeNames, type.name));
    }
}
