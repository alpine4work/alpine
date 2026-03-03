import {Mark, Node, ResolvedPos} from "prosemirror-model";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

/**
 * Get an array of marks that apply to all inline nodes in a given range that
 * support that mark. So if you have an inline node in the middle of the range
 * (e.g. a horizontal divider) that can't be bold, if the surrounding nodes are
 * bold then we will return the bold mark in this array.
 */
export function getMarksSpanningAcrossEntireRange(
    parentNode: Node,
    range: {from: number; to: number},
): ReadonlyArray<Mark> {
    range = trimSpacesFromProsemirrorRange(parentNode, range);

    const previousInlineNodes: Array<{node: Node; $pos: ResolvedPos}> = [];
    let marks: Array<Mark> | null = null;

    parentNode.nodesBetween(range.from, range.to, (node, pos) => {
        if (!node.isInline) return;

        const $pos = parentNode.resolve(pos);

        if (marks === null) {
            marks = [...node.marks];
        } else {
            const newMarks = [];

            // `newMarks` should be the intersection of `mark` and `node.marks`. Unless
            // `node.marks` has a mark that wasn't applicable for previous inline nodes.
            for (const mark of node.marks) {
                if (mark.isInSet(marks)) {
                    newMarks.push(mark);
                }
                // If this node's mark was not in our existing marks set but that was because no
                // previous inline node supported it, then we want to include the mark in
                // `newMarks`.
                else if (
                    previousInlineNodes.every(
                        previousInlineNode =>
                            !previousInlineNode.$pos.parent.type.allowsMarkType(mark.type),
                    )
                ) {
                    newMarks.push(mark);
                }
            }

            // For all our previous marks, add any to `newMark` that are not supported by this
            // node.
            //
            // This way we still count a mark as spanning across an entire range even if there
            // are some intermediate nodes that don't support the mark.
            for (const mark of marks) {
                if (!$pos.parent.type.allowsMarkType(mark.type)) {
                    newMarks.push(mark);
                }
            }

            marks = newMarks;
        }

        previousInlineNodes.push({node, $pos});
    });

    return marks ?? [];
}
