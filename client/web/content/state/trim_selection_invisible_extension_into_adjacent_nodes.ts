import {ResolvedPos} from "prosemirror-model";

/**
 * When selecting text in Chrome, sometimes the selection appears to only be
 * selecting a single element but in fact the end position (`$to` in ProseMirror
 * parlance) is at the beginning of the next node. Chrome doesn't render this but
 * it's there.
 *
 * This can lead to very confusing behaviors for users who assume their selection
 * is only within one node when in fact it's in two. We fix this on the ProseMirror
 * side. By detecting selections which invisibly extend into adjacent nodes and
 * trim the selection edges.
 *
 * To test this, write a three bullet list with your keyboard in Chrome.
 *
 * ```
 * - foo
 * - bar
 * - qux
 * ```
 *
 * Place your cursor at `|`
 *
 * ```
 * - foo
 * - |bar
 * - qux
 * ```
 *
 * Hold shift and press the right arrow three times so you should have all of "bar"
 * selected (`[` indicates selection start and `]` indicates selection end):
 *
 * ```
 * - foo
 * - [bar]
 * - qux
 * ```
 *
 * Hold shift while pressing the right arrow one more time. It will still look like
 * only "bar" is selected in Chrome. But in fact if you call
 * `window.getSelection()` or look at ProseMirror's `EditorState` selection the
 * underlying selection actually looks like this:
 *
 * ```
 * - foo
 * - [bar
 * - ]qux
 * ```
 *
 * Chrome just doesn't have a capability to render the selection from the end of
 * "bar" to the beginning of "qux". If you hold shift while pressing the right
 * arrow one more time you'll get this:
 *
 * ```
 * - foo
 * - [bar
 * - q]ux
 * ```
 *
 * If you hit tab while in this state:
 *
 * ```
 * - foo
 * - [bar
 * - ]qux
 * ```
 *
 * Without `trimSelectionInvisibleExtensionIntoAdjacentNodes()` then we indent both
 * "bar" and "qux"! Which makes sense if you look at the internal editor state but
 * is confusing for the user if they look at the selection Chrome has rendered.
 *
 * What `trimSelectionInvisibleExtensionIntoAdjacentNodes()` does is trims the
 * selection to just "bar" before we run our indent logic so we only indent what is
 * visibly selected. Not what's invisibly selected.
 *
 * Other browsers may behave differently.
 */
export function trimSelectionInvisibleExtensionIntoAdjacentNodes(selection: {
    $from: ResolvedPos;
    $to: ResolvedPos;
}): {
    $from: ResolvedPos;
    $to: ResolvedPos;
} {
    if (selection.$from.pos === selection.$to.pos) return selection;

    let $newFrom: ResolvedPos | undefined;
    let $newTo: ResolvedPos | undefined;

    if (selection.$from.parentOffset === selection.$from.parent.nodeSize - 2) {
        const docNodeSize = selection.$from.doc.nodeSize;
        for (
            let pos = selection.$from.pos + 1;
            pos < docNodeSize - 2 && pos <= selection.$to.pos;
            pos++
        ) {
            const $pos = selection.$from.doc.resolve(pos);

            if ($pos.parent.isTextblock && $pos.parentOffset === 0) {
                $newFrom = $pos;
                break;
            }
        }
    }

    if (selection.$to.parentOffset === 0) {
        for (let pos = selection.$to.pos - 1; pos > 0 && pos >= selection.$from.pos; pos--) {
            const $pos = selection.$to.doc.resolve(pos);

            if ($pos.parent.isTextblock && $pos.parentOffset === $pos.parent.nodeSize - 2) {
                $newTo = $pos;
                break;
            }
        }
    }

    if ($newFrom === undefined && $newTo === undefined) return selection;
    return {$from: $newFrom ?? selection.$from, $to: $newTo ?? selection.$to};
}
