import {Node} from "prosemirror-model";
import {assertId} from "~/shared/id/id.open_source.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.open_source.js";
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";

/**
 * Find all the `DocumentCommentThreadId`s currently referenced in the provided
 * `DocumentContent`.
 */
export function getReferencedDocumentCommentThreadIds(content: Node): Set<DocumentCommentThreadId> {
    const commentThreadIds = new Set<DocumentCommentThreadId>();

    visitProsemirrorNode(content, {
        visitMark: mark => {
            if (mark.type.name === "comment") {
                commentThreadIds.add(assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId));
            }
        },
    });

    return commentThreadIds;
}
