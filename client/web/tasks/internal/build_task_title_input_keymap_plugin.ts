import {chainCommands, deleteSelection} from "prosemirror-commands";
import {keydownHandler} from "prosemirror-keymap";
import {Command, Plugin} from "prosemirror-state";
import {addSharedContentEditorKeymapCommands} from "~/client/web/content/state/shared/add_shared_content_editor_keymap_commands.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";

export function buildTaskTitleInputKeymapPlugin() {
    const keys = new Map<string, Command>();

    // By default, ProseMirror doesn't handle the backspace key when the selection
    // is `AllSelection`. Which'll happen if the user double clicks in the margin
    // after a task title. So we need to add `deleteSelection` handling for
    // backspace keys.
    keys.set("Backspace", deleteSelection);
    keys.set("Shift-Backspace", deleteSelection);
    keys.set("Ctrl-Backspace", deleteSelection);
    keys.set("Mod-Backspace", deleteSelection);
    keys.set("Delete", deleteSelection);
    keys.set("Shift-Delete", deleteSelection);
    keys.set("Ctrl-Delete", deleteSelection);
    keys.set("Mod-Delete", deleteSelection);

    // Based on the [ProseMirror base MacOS keybinding][1] map and the [MacOS
    // keyboard shortcut][2] documentation.
    //
    // [1]: https://github.com/ProseMirror/prosemirror-commands/blob/3126d5c625953ba590c5d3a0db7f1009f46f1571/src/commands.js#L588
    // [2]: https://support.apple.com/en-us/HT201236
    if (typeof window !== "undefined" && getClientInfo().isAppleDevice) {
        keys.set("Alt-Backspace", deleteSelection);
        keys.set("Alt-Delete", deleteSelection);
        keys.set("Ctrl-h", deleteSelection);
        keys.set("Ctrl-d", deleteSelection);
    }

    {
        const sharedKeys = new Map<string, Command>();
        addSharedContentEditorKeymapCommands(sharedKeys);

        for (const [key, sharedCommand] of sharedKeys) {
            const command = keys.get(key);
            if (command === undefined) {
                keys.set(key, sharedCommand);
            } else {
                keys.set(key, chainCommands(sharedCommand, command));
            }
        }
    }

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
