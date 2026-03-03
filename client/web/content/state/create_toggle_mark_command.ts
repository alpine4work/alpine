import {Mark} from "prosemirror-model";
import {Command, EditorState, TextSelection, Transaction} from "prosemirror-state";
import {normalizeContentEditorCodeText} from "~/client/web/content/state/internal/normalize_content_editor_code_text.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

/**
 * Creates a command that toggles the provided mark on and off in the `EditorState`
 * selection.
 *
 * Different from the built-in `toggleMark()` command in that if some nodes already
 * have the mark we toggle on instead of off. We believe this is a more intuitive
 * UX for a user when they execute this command through a button press or keyboard
 * shortcut.
 *
 * Options:
 *
 * - `requireNonEmptySelection`: If true, the command will only execute if the
 *   current selection is not empty.
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
            // If we have found one node that can become our mark type we don't need to keep
            // iterating.
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

        // If you hit Cmd-B then type, the text should be bold. That's what stored marks
        // do.
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
            let transaction = state.tr;

            if (mark.type.name === "code") {
                actuallyNormalizeContentEditorCodeText(state, transaction, range);
            }

            transaction = transaction.addMark(
                transaction.mapping.map(range.from, -1),
                transaction.mapping.map(range.to, 1),
                mark,
            );
            dispatch?.(transaction.scrollIntoView());
            return true;
        }

        return changedStoredMarks;
    };
}

function actuallyNormalizeContentEditorCodeText(
    state: EditorState,
    transaction: Transaction,
    range: {from: number; to: number},
) {
    const replacements: Array<{
        from: number;
        to: number;
        text: string;
        marks: ReadonlyArray<Mark>;
    }> = [];

    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (!node.isText || !node.text) return;

        const nodeStart = pos;
        const nodeEnd = pos + node.nodeSize;
        const overlapFrom = Math.max(range.from, nodeStart);
        const overlapTo = Math.min(range.to, nodeEnd);

        if (overlapFrom >= overlapTo) return;

        const startIndex = overlapFrom - nodeStart;
        const endIndex = overlapTo - nodeStart;
        const segment = node.text.slice(startIndex, endIndex);
        const segmentReplacements = normalizeContentEditorCodeText(segment);

        for (const replacement of segmentReplacements) {
            replacements.push({
                from: nodeStart + startIndex + replacement.from,
                to: nodeStart + startIndex + replacement.to,
                text: replacement.text,
                marks: node.marks,
            });
        }
    });

    for (const replacement of replacements.reverse()) {
        transaction.replaceWith(
            transaction.mapping.map(replacement.from, 1),
            transaction.mapping.map(replacement.to, -1),
            state.schema.text(replacement.text, replacement.marks),
        );
    }
}
