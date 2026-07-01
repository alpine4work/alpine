import {Node, ResolvedPos} from "prosemirror-model";
import {cutContent} from "~/shared/content/cut_content.js";
import {getContentSnippetPos} from "~/shared/content/get_content_snippet.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";

export type DocumentCommentThreadSnippet = {
    /**
     * Add this to a position inside `node` to get the corresponding position in the
     * source document.
     */
    pos: number;

    /**
     * The snippet content cut from the document.
     */
    node: Node;
};

/**
 * Creates a function that will incrementally collect snippets from a document for
 * the provided comment threads at the first position the comment thread appears.
 * If a comment thread does not exist in a document then you will not get a
 * snippet.
 *
 * Uses `createProsemirrorIncrementalReducer()` under the hood to avoid full
 * document traversals whenever the document changes. You should use this with two
 * separate `useMemo()`s in a React component. One that just depends on the
 * `DocumentCommentThreadId`s and another that depends on the full document. The
 * first `useMemo()` will cache subsets of the document we've seen before.
 */
export function createDocumentCommentThreadSnippetCollector(
    commentThreadIds: Iterable<DocumentCommentThreadId>,
) {
    const commentThreadIdSet = new Set(commentThreadIds);

    const getResolvedPosByCommentThreadId = createProsemirrorIncrementalReducer<
        Map<DocumentCommentThreadId, ResolvedPos>
    >(node => {
        const relevantCommentThreadIds: Array<DocumentCommentThreadId> = filterMapArray(
            node.marks,
            mark => {
                if (mark.type.name !== "comment") return;
                if (!commentThreadIdSet.has(mark.attrs.commentThreadId)) return;
                return mark.attrs.commentThreadId;
            },
        );
        if (relevantCommentThreadIds.length === 0) return null;

        return (resolvedPosByCommentThreadId, doc, offset) => {
            for (const commentThreadId of relevantCommentThreadIds) {
                getOrSetDefaultMapValue(resolvedPosByCommentThreadId, commentThreadId, () =>
                    doc.resolve(offset),
                );
            }
            return resolvedPosByCommentThreadId;
        };
    });

    return (doc: DocumentContent): Map<DocumentCommentThreadId, DocumentCommentThreadSnippet> => {
        const resolvedPosByCommentThreadId = getResolvedPosByCommentThreadId(new Map(), doc);

        return new Map(
            mapIterable(resolvedPosByCommentThreadId, ([commentThreadId, resolvedPos]) => {
                // Enough lines to fill a document comment thread preview component.
                const snippetPos = getContentSnippetPos(resolvedPos, {
                    linesAbove: 2,
                    linesBelow: 8,
                });

                return [
                    commentThreadId,
                    {
                        // NOCOMMIT: Don't try to return `pos`
                        pos: getCutContentPosOffset(doc, snippetPos.from),
                        node: cutContent(doc, snippetPos.from, snippetPos.to),
                    },
                ];
            }),
        );
    };
}

function getCutContentPosOffset(doc: Node, from: number): number {
    const resolvedFrom = doc.resolve(from);

    // `Node.cut()` keeps the ancestors opened by `from` so the first copied top node
    // starts at local position `0`. Each open ancestor adds one local position before
    // the cut content, so subtract the open depth to convert the cut range start into
    // the offset used by local snippet positions.
    return from - resolvedFrom.depth;
}
