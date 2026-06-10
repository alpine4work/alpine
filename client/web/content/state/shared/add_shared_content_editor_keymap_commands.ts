import {chainCommands} from "prosemirror-commands";
import {EditorState, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    isTrackingSomeSelectionWithinSharedContentEditor,
    trackSelectionWithinSharedContentEditor,
} from "~/client/web/content/state/shared/shared_content_editor_track_selection_within_plugin.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type Command = (
    state: EditorState,
    transact?: (tr: Transaction) => void,
    view?: EditorView,
) => boolean;

function getPunctuation(
    // eslint-disable-next-line cyberworlds/string-quotes
    punctuation: "(" | "{" | "[" | '"' | "'",
    isInCodeBlock: boolean,
): {openingPunctuation: string; closingPunctuation: string} {
    // If we are in a code block, we do not want smart quotations to wrap our content
    if (isInCodeBlock) {
        switch (punctuation) {
            case "(":
                return {openingPunctuation: "(", closingPunctuation: ")"};
            case "{":
                return {openingPunctuation: "{", closingPunctuation: "}"};
            case "[":
                return {openingPunctuation: "[", closingPunctuation: "]"};
            /* eslint-disable cyberworlds/string-quotes */
            case '"':
                return {openingPunctuation: '"', closingPunctuation: '"'};
            case "'":
                return {openingPunctuation: "'", closingPunctuation: "'"};
            /* eslint-enable cyberworlds/string-quotes */
            default:
                throw exhaustive(punctuation);
        }
    } else {
        switch (punctuation) {
            case "(":
                return {openingPunctuation: "(", closingPunctuation: ")"};
            case "{":
                return {openingPunctuation: "{", closingPunctuation: "}"};
            case "[":
                return {openingPunctuation: "[", closingPunctuation: "]"};
            /* eslint-disable cyberworlds/string-quotes */
            case '"':
                return {openingPunctuation: "\u201C", closingPunctuation: "\u201D"};
            case "'":
                return {openingPunctuation: "\u2018", closingPunctuation: "\u2019"};
            /* eslint-enable cyberworlds/string-quotes */
            default:
                throw exhaustive(punctuation);
        }
    }
}

let nextSelectionTrackerKey = 1;

function wrapWithPunctuation(
    // eslint-disable-next-line cyberworlds/string-quotes
    punctuation: "(" | "{" | "[" | '"' | "'",
    {
        withoutAutoBalancing = false,
        ignoredPreviousCharacters,
    }: {
        withoutAutoBalancing?: boolean;
        ignoredPreviousCharacters?: Array<string>;
    } = {},
): Command {
    return (state, dispatch) => {
        const {$from, $to} = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);
        const nodeFrom = $from.node();
        const nodeTo = $to.node();

        // This checks if the selection spans across content nodes. If the selection is in
        // the same `codeBlock` then we allow it to span across multiple `codeBlockLine`s.
        if (nodeFrom !== nodeTo) {
            if (nodeFrom.type.name !== "codeBlockLine" || nodeTo.type.name !== "codeBlockLine") {
                return false;
            } else {
                const parentNodeFrom = $from.node($from.depth - 1);
                const parentNodeTo = $to.node($to.depth - 1);

                if (parentNodeFrom !== parentNodeTo) return false;
            }
        }

        const isInCode =
            nodeFrom.type.name === "codeBlockLine" ||
            $from.marks().some(mark => mark.type.name === "code");

        if ($from.pos === $to.pos) {
            if (withoutAutoBalancing) return false;

            // Check if there's an ignored character immediately before the punctuation
            if (
                ignoredPreviousCharacters &&
                ignoredPreviousCharacters.length > 0 &&
                $from.pos > 0
            ) {
                const previousChar = state.doc.textBetween($from.pos - 1, $from.pos);
                if (ignoredPreviousCharacters.includes(previousChar)) {
                    return false;
                }
            }

            // If the user doesn't have text selected, always create a matching bracket. This
            // is useful in code where there are many brackets but also in regular prose when
            // the user is writing a parenthetical.
            if (dispatch) {
                const {openingPunctuation, closingPunctuation} = getPunctuation(
                    punctuation,
                    isInCode,
                );

                const transaction = state.tr;
                transaction.insertText(openingPunctuation + closingPunctuation, $from.pos);
                transaction.setSelection(new TextSelection(transaction.doc.resolve($from.pos + 1)));

                trackSelectionWithinSharedContentEditor(
                    transaction,
                    `${punctuation}-${nextSelectionTrackerKey++}`,
                    {start: $from.pos + 1, end: $from.pos + 2},
                );

                dispatch(transaction);
            }
            return true;
        }

        if (dispatch) {
            const {openingPunctuation, closingPunctuation} = getPunctuation(punctuation, isInCode);

            const transaction = state.tr;
            transaction.insertText(openingPunctuation, $from.pos);
            transaction.insertText(closingPunctuation, $to.pos + 1);

            dispatch(
                transaction.setSelection(
                    new TextSelection(
                        transaction.doc.resolve($from.pos + 1),
                        transaction.doc.resolve($to.pos + 1),
                    ),
                ),
            );
        }

        return true;
    };
}

/**
 * If the user types closing punctuation (e.g. `)`) and we've already inserted the
 * closing punctuation (e.g. when you type `(` we insert `()` and put your cursor
 * inside) don't insert a second closing punctuation character.
 *
 * This depends on the user typing only within the punctuation. If their selection
 * moves outside of the punctuation we'll insert their closing punctuation as
 * normal.
 */
// eslint-disable-next-line cyberworlds/string-quotes
function skipClosingPunctuation(punctuation: "(" | "{" | "[" | '"' | "'"): Command {
    return (state, dispatch) => {
        const {$from, $to} = state.selection;
        if ($from.pos !== $to.pos) return false;

        if (
            isTrackingSomeSelectionWithinSharedContentEditor(
                state,
                (key, tracker) =>
                    key.startsWith(`${punctuation}-`) && tracker.end === $from.pos + 1,
            )
        ) {
            dispatch?.(state.tr.setSelection(new TextSelection(state.doc.resolve($from.pos + 1))));
            return true;
        }

        return false;
    };
}

/**
 * Add keymap commands available in all ProseMirror editors in our product. Not
 * just `<ContentEditor>`. For example `<TaskRowTitleInput>` is a ProseMirror
 * editor that doesn't use content.
 *
 * If you used shared keymap commands you should also make sure the editor is using
 * `sharedContentEditorTrackSelectionWithinPlugin()`.
 */
export function addSharedContentEditorKeymapCommands(keys: Map<string, Command>) {
    /* eslint-disable cyberworlds/string-quotes */
    if (!isMobileWebKit) {
        // Allow :( to turn into sad emoji
        keys.set("(", wrapWithPunctuation("(", {ignoredPreviousCharacters: [":"]}));
        keys.set("[", wrapWithPunctuation("["));
        keys.set("{", wrapWithPunctuation("{"));

        // You open and close quotes with the same character. Chain the commands together.
        keys.set('"', chainCommands(skipClosingPunctuation('"'), wrapWithPunctuation('"')));

        keys.set(
            "'",
            wrapWithPunctuation("'", {
                // Don't auto balance single quotes since they're often used in contractions. We
                // may want to auto balance single quotes in code (if you have a single quoted
                // string) but it's tough since we don't want contractions in comments to be auto
                // balanced.
                withoutAutoBalancing: true,
            }),
        );
    }

    keys.set(")", skipClosingPunctuation("("));
    keys.set("]", skipClosingPunctuation("["));
    keys.set("}", skipClosingPunctuation("{"));

    /* eslint-enable cyberworlds/string-quotes */

    const backspaceCommand: Command = (state, dispatch) => {
        const {$from, $to} = state.selection;
        if ($from.pos !== $to.pos) return false;

        if (!(0 <= $from.pos - 1 && $from.pos + 1 <= state.doc.nodeSize - 2)) return false;

        const $bracketStart = state.doc.resolve($from.pos - 1);
        const $bracketEnd = state.doc.resolve($from.pos + 1);
        if ($bracketStart.node() !== $bracketEnd.node()) return false;

        const text = state.doc.textBetween($bracketStart.pos, $bracketEnd.pos);
        if (
            text === "()" ||
            text === "[]" ||
            text === "{}" ||
            // eslint-disable-next-line cyberworlds/string-quotes
            text === '""' ||
            text === "\u201C\u201D"
            // Since we don't auto-balance single quotes (to avoid confusing them with
            // contractions) we won't delete empty single quotes.
            //
            // ```
            // text === "''" ||
            // text === "''"
            // ```
        ) {
            dispatch?.(state.tr.deleteRange($bracketStart.pos, $bracketEnd.pos));
            return true;
        }

        return false;
    };

    // If the user presses backspace in brackets with no text between, delete the
    // entire bracket. This is particularly useful after they've pressed an open
    // bracket character if they want to delete the extra inserted bracket.
    keys.set("Backspace", backspaceCommand);

    if (typeof window !== "undefined" && getClientInfo().isAppleDevice) {
        keys.set("Alt-Backspace", backspaceCommand);
    }
}
