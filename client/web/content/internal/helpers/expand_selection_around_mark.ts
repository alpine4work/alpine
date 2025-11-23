import {Mark, Node} from "prosemirror-model";
import {Selection, TextSelection} from "prosemirror-state";

/**
 * Expand the editor selection to include all text in the current text block
 * with the same mark of a type (e.g. link). If there's no mark of the type
 * covering the selection return null. Allows you to update a mark all at once.
 */
export function expandSelectionAroundMark(
    doc: Node,
    selection: Selection,
    markName: string,
): {selection: TextSelection; mark: Mark} | null {
    if (!(selection instanceof TextSelection)) return null;

    const parentNode = selection.$from.parent;
    if (!parentNode.isTextblock) return null;
    if (parentNode !== selection.$to.parent) return null;

    let mark: Mark | undefined;

    // 1. Try to find the mark within the selection (if selection is not empty)
    const selectionSlice = selection.content();
    let isSelectionNodeMissingMark = false;
    selectionSlice.content.nodesBetween(0, selectionSlice.content.size, node => {
        if (!node.isText) return;
        if (isSelectionNodeMissingMark) return;

        const currentMark = node?.marks.find(mark => mark.type.name === markName);
        if (!currentMark) {
            isSelectionNodeMissingMark = true;
            return;
        }

        if (!mark) {
            mark = currentMark;
        } else if (!mark.eq(currentMark)) {
            isSelectionNodeMissingMark = true;
            return;
        }
    });
    if (isSelectionNodeMissingMark) return null;

    const selectionNodeBefore = selection.$from.nodeBefore;
    if (selectionNodeBefore && !selectionNodeBefore.isText) return null;

    const selectionNodeAfter = selection.$to.nodeAfter;
    if (selectionNodeAfter && !selectionNodeAfter.isText) return null;

    // 2. Try to find the mark before the selection (if selection isn't
    //    at start)
    const selectionNodeBeforeMark = selectionNodeBefore?.marks.find(
        mark => mark.type.name === markName,
    );
    if (selectionNodeBeforeMark) {
        if (!mark) {
            mark = selectionNodeBeforeMark;
        } else if (!mark.eq(selectionNodeBeforeMark)) {
            return null;
        }
    }

    // 3. Try to find the mark after the selection (if selection isn't
    //    at end)
    const selectionNodeAfterMark = selectionNodeAfter?.marks.find(
        mark => mark.type.name === markName,
    );
    if (selectionNodeAfterMark) {
        if (!mark) {
            mark = selectionNodeAfterMark;
        } else if (!mark.eq(selectionNodeAfterMark)) {
            return null;
        }
    }

    // If we found no mark, this isn't a link selection.
    if (!mark) return null;

    let extendFrom = selectionNodeBeforeMark ? selectionNodeBefore?.nodeSize ?? 0 : 0;
    if (selectionNodeBeforeMark) {
        // If `textOffset` is 0 then `nodeBefore` will be the full child before the
        // node `$from` points to.
        // https://github.com/ProseMirror/prosemirror-model/blob/a37b6b3adeb548dc9822211b680ce9d31be65842/src/resolvedpos.ts#L107-L115
        const startIndex = selection.$from.index() - (selection.$from.textOffset === 0 ? 2 : 1);

        for (let i = startIndex; i >= 0; i--) {
            const previousNode = parentNode.child(i);
            if (previousNode.marks.some(otherMark => otherMark.eq(mark!))) {
                extendFrom += previousNode.nodeSize;
            } else {
                break;
            }
        }
    }

    let extendTo = selectionNodeAfterMark ? selectionNodeAfter?.nodeSize ?? 0 : 0;
    if (selectionNodeAfterMark) {
        const startIndex = selection.$to.index() + 1;

        for (let i = startIndex; i < parentNode.childCount; i++) {
            const nextNode = parentNode.child(i);
            if (nextNode.marks.some(otherMark => otherMark.eq(mark!))) {
                extendTo += nextNode.nodeSize;
            } else {
                break;
            }
        }
    }

    return {
        selection: new TextSelection(
            doc.resolve(selection.from - extendFrom),
            doc.resolve(selection.to + extendTo),
        ),
        mark,
    };
}
