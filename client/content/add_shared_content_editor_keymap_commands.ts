import {keydownHandler} from "prosemirror-keymap";
import {EditorState, Plugin, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {setContentEditorQuickUndo} from "~/client/content/content_editor_state.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type Command = (
    state: EditorState,
    transact?: (tr: Transaction) => void,
    view?: EditorView,
) => boolean;

function getPunctuation(
    punctuation: "(" | "{" | "[" | '"' | "'",
    isInCodeBlock: boolean,
): {openingPunctuation: string; closingPunctuation: string} {
    // If we are in a code block, we do not want smart quotations to wrap
    // our content
    if (isInCodeBlock) {
        switch (punctuation) {
            case "(":
                return {openingPunctuation: "(", closingPunctuation: ")"};
            case "{":
                return {openingPunctuation: "{", closingPunctuation: "}"};
            case "[":
                return {openingPunctuation: "[", closingPunctuation: "]"};
            case '"':
                return {openingPunctuation: '"', closingPunctuation: '"'};
            case "'":
                return {openingPunctuation: "'", closingPunctuation: "'"};
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
            case '"':
                return {openingPunctuation: "“", closingPunctuation: "”"};
            case "'":
                return {openingPunctuation: "‘", closingPunctuation: "’"};
            default:
                throw exhaustive(punctuation);
        }
    }
}

function wrapWithPunctuation(punctuation: "(" | "{" | "[" | '"' | "'"): Command {
    return (state, dispatch) => {
        const {$from, $to} = state.selection;
        const nodeFrom = $from.node();
        const nodeTo = $to.node();

        // This checks if the selection spans across content nodes
        if (nodeFrom !== nodeTo) return false;

        const isInCodeBlock = nodeFrom.type.name === "codeBlockLine";

        if ($from.pos === $to.pos) {
            const isInCode = $from.marks().some(mark => mark.type.name === "code");

            // If we are in a code block then create a matching bracket since we assume the
            // user wants balanced brackets. Arguably, we should always create balanced
            // brackets? Even in regular text? Users rarely type `(` without wanting `)`.
            if (isInCodeBlock || isInCode) {
                if (dispatch) {
                    const {openingPunctuation, closingPunctuation} = getPunctuation(
                        punctuation,
                        true,
                    );

                    let transaction = state.tr;
                    transaction.insertText(openingPunctuation + closingPunctuation, $from.pos);

                    transaction.setSelection(
                        new TextSelection(transaction.doc.resolve($from.pos + 1)),
                    );

                    transaction = setContentEditorQuickUndo(
                        transaction,
                        "Backspace",
                        $from.pos,
                        (state, dispatch, pos) => {
                            const text = state.doc.textBetween(pos, pos + 2);
                            if (text !== openingPunctuation + closingPunctuation) return false;

                            dispatch?.(state.tr.deleteRange(pos, pos + 2));
                            return true;
                        },
                    );

                    dispatch(transaction);
                }
                return true;
            }

            return false;
        }

        if (dispatch) {
            const {openingPunctuation, closingPunctuation} = getPunctuation(
                punctuation,
                isInCodeBlock,
            );

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

export function addSharedContentEditorKeymapCommands(keys: Map<string, Command>) {
    keys.set("(", wrapWithPunctuation("("));
    keys.set("[", wrapWithPunctuation("["));
    keys.set("{", wrapWithPunctuation("{"));
    keys.set('"', wrapWithPunctuation('"'));
    keys.set("'", wrapWithPunctuation("'"));
}

export function buildSharedContentEditorKeymapPlugin() {
    const keys = new Map<string, Command>();
    addSharedContentEditorKeymapCommands(keys);

    const handleKeyDown = keydownHandler(Object.fromEntries(keys));

    return new Plugin({
        props: {
            // Our codebase convention is to call `event.preventDefault()` and
            // `event.stopPropagation()` whenever a `keydown` event is handled. ProseMirror
            // will only call `event.preventDefault()` when a keydown handler returns true.
            // So construct a plugin where we also call `event.stopPropagation()`.
            //
            // We call `event.stopPropagation()` so global `keydown` handlers don't see
            // events we've already handled. Particularly important for undo where we have
            // a global undo handler and a local undo handler. If our local undo handles
            // the keyboard shortcut we don't want to run our global handler.
            handleKeyDown: (view, event) => {
                const result = handleKeyDown(view, event);
                if (result) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return result;
            },
        },
    });
}
