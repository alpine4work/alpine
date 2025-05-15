import {Mark} from "prosemirror-model";
import {Command, TextSelection} from "prosemirror-state";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

/**
 * Creates a command that toggles the provided mark on and off in the
 * `EditorState` selection.
 *
 * Different from the built-in `toggleMark()` command in that if some nodes
 * already have the mark we toggle on instead of off. We believe this is a more
 * intuitive UX for a user when they execute this command through a button
 * press or keyboard shortcut.
 *
 * Options:
 * - `requireNonEmptySelection`: If true, the command will only execute if the current selection
 *    is not empty.
 */
export function createToggleMarkCommand(
    mark: Mark,
    options?: {requireNonEmptySelection?: boolean},
): Command {
    return (state, dispatch) => {
        if (options?.requireNonEmptySelection && state.selection.empty) {
            return false;
        }

        let doesAnyNodeAllowMarkType = false;
        let doesEveryNodeAlreadyHaveMarkType: boolean | undefined;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found one node that can become our mark type we don't need to
            // keep iterating.
            if (doesAnyNodeAllowMarkType) return false;

            // Ignore nodes that aren't inline.
            if (!node.isInline) return;

            // Ignore nodes that don't support our mark type.
            const $pos = state.doc.resolve(pos);
            if (!$pos.parent.type.allowsMarkType(mark.type)) return;

            if (mark.isInSet(node.marks)) {
                if (doesEveryNodeAlreadyHaveMarkType === undefined)
                    doesEveryNodeAlreadyHaveMarkType = true;
                return;
            }

            doesEveryNodeAlreadyHaveMarkType = false;
            doesAnyNodeAllowMarkType = true;
        });

        // If there were no nodes then this variable is false.
        if (doesEveryNodeAlreadyHaveMarkType === undefined)
            doesEveryNodeAlreadyHaveMarkType = false;

        // If you hit Cmd-B then type, the text should be bold. That's what stored
        // marks do.
        let changedStoredMarks = false;
        if (state.selection instanceof TextSelection && state.selection.$cursor) {
            if (mark.type.isInSet(state.storedMarks ?? state.selection.$cursor.marks())) {
                dispatch?.(state.tr.removeStoredMark(mark.type));
            } else {
                dispatch?.(state.tr.addStoredMark(mark));
            }
            changedStoredMarks = true;
        }

        if (doesEveryNodeAlreadyHaveMarkType) {
            dispatch?.(
                state.tr
                    .removeMark(state.selection.from, state.selection.to, mark)
                    .scrollIntoView(),
            );
            return true;
        }

        if (doesAnyNodeAllowMarkType) {
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
            dispatch?.(state.tr.addMark(range.from, range.to, mark).scrollIntoView());
            return true;
        }

        return changedStoredMarks;
    };
}
