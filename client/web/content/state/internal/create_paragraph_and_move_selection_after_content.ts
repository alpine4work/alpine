import {EditorState, TextSelection, Transaction} from "prosemirror-state";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Creates an empty paragraph at a given position and moves the cursor to it.
 * Defaults position to the end of the document.
 */
export function createParagraphAndMoveSelectionAfterContent(
    state: EditorState,
    dispatch: (tr: Transaction) => void,
    options?: {position?: number; selectionPosOffset?: number},
): boolean {
    assert(state.schema.nodes.paragraph);

    const insertPos = options?.position !== undefined ? options.position : state.doc.content.size;
    const selectionPos = insertPos + 1 + (options?.selectionPosOffset || 0);

    const tr = state.tr;
    tr.insert(insertPos, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    tr.scrollIntoView();
    dispatch(tr);
    return true;
}
