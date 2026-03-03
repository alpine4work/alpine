import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {
    ContentReferencedIds,
    ContentReferencedIdsSchema,
    collectContentReferencedIds,
    isEmptyContentReferencedIds,
} from "~/shared/content/content_referenced_ids.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorVisitor,
    visitProsemirrorNode,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Just the IDs we need for loading a `ContentReferences` object. Useful to perform
 * optimizations against. If there are no `ContentReferencedIds` then you don't
 * need to make a network request.
 */
export type DocumentContentReferencedIds = SchemaType<typeof DocumentContentReferencedIdsSchema>;

export const DocumentContentReferencedIdsSchema = ContentReferencedIdsSchema.merge(
    Schema.object({
        commentThreadIds: Schema.set(Schema.id<DocumentCommentThreadId>()),
    }),
);

/**
 * Is the provided `DocumentContentReferencedIds` object empty?
 */
export function isEmptyDocumentContentReferencedIds(
    referencedIds: DocumentContentReferencedIds,
): boolean {
    // If you add more data to `DocumentContentReferencedIds` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<
        Exclude<keyof DocumentContentReferencedIds, keyof ContentReferencedIds>,
        "commentThreadIds"
    >();

    return isEmptyContentReferencedIds(referencedIds) && referencedIds.commentThreadIds.size === 0;
}

export function getDocumentContentReferencedIdsForNode(
    node: Node,
    {ignoreCommentThreadIds}: {ignoreCommentThreadIds?: ReadonlySet<DocumentCommentThreadId>} = {},
): DocumentContentReferencedIds {
    return collectDocumentContentReferencedIds(
        visitor => {
            visitProsemirrorNode(node, visitor);
        },
        {ignoreCommentThreadIds},
    );
}

export function getDocumentContentReferencedIdsForSteps(
    steps: ReadonlyArray<Step>,
    {ignoreCommentThreadIds}: {ignoreCommentThreadIds?: ReadonlySet<DocumentCommentThreadId>} = {},
): DocumentContentReferencedIds {
    return collectDocumentContentReferencedIds(
        visitor => {
            for (const step of steps) {
                visitProsemirrorStep(step, visitor);
            }
        },
        {ignoreCommentThreadIds},
    );
}

function collectDocumentContentReferencedIds(
    visit: (visitor: ProsemirrorVisitor) => void,
    {
        ignoreCommentThreadIds,
    }: {ignoreCommentThreadIds: ReadonlySet<DocumentCommentThreadId> | undefined},
): DocumentContentReferencedIds {
    const commentThreadIds = new Set<DocumentCommentThreadId>();

    const referencedIds = collectContentReferencedIds(visit, {
        visitMark: mark => {
            if (mark.type.name === "comment") {
                const commentThreadId = assertId<DocumentCommentThreadId>(
                    mark.attrs.commentThreadId,
                );
                if (!ignoreCommentThreadIds?.has(commentThreadId)) {
                    commentThreadIds.add(commentThreadId);
                }
            }
        },
    });

    return {...referencedIds, commentThreadIds};
}
