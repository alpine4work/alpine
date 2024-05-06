import {keydownHandler} from "prosemirror-keymap";
import {EditorState, Plugin, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type Command = (
    state: EditorState,
    transact?: (tr: Transaction) => void,
    view?: EditorView,
) => boolean;

function getClosingPunctuation(openingPunctuation: "(" | "{" | "[" | "“" | "‘"): string {
    switch (openingPunctuation) {
        case "(":
            return ")";
        case "{":
            return "}";
        case "[":
            return "]";
        case "“":
            return "”";
        case "‘":
            return "’";
        default:
            throw exhaustive(openingPunctuation);
    }
}

function wrapWithPunctuation(openingPunctuation: "(" | "{" | "[" | "“" | "‘"): Command {
    return (state, dispatch) => {
        const {$from, $to} = state.selection;

        // this checks if the selection spans across content nodes
        if ($from.node() !== $to.node()) return false;
        if ($from.pos === $to.pos) return false;

        const closingPunctuation = getClosingPunctuation(openingPunctuation);
        const tr = state.tr;
        tr.insertText(openingPunctuation, $from.pos);
        tr.insertText(closingPunctuation, $to.pos + 1);

        dispatch?.(
            tr.setSelection(
                new TextSelection(
                    tr.doc.resolve(state.selection.from + 1),
                    tr.doc.resolve(state.selection.to + 1),
                ),
            ),
        );

        return true;
    };
}

export function addSharedContentEditorKeymapCommands(keys: Map<string, Command>) {
    keys.set("(", wrapWithPunctuation("("));
    keys.set("[", wrapWithPunctuation("["));
    keys.set("{", wrapWithPunctuation("{"));
    keys.set('"', wrapWithPunctuation("“"));
    keys.set("'", wrapWithPunctuation("‘"));
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
