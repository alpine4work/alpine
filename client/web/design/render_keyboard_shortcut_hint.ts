/**
 * Helper for rendering a keyboard shortcut hint string that has a consistent
 * design across the entire app.
 */
export function renderKeyboardShortcutHint(
    clientInfo: {isAppleDevice: boolean},
    modKey: "mod",
    hotKey: KeyboardShortcutHintHotKey,
): string;
export function renderKeyboardShortcutHint(
    clientInfo: {isAppleDevice: boolean},
    modKey: "mod",
    shiftKey: "shift",
    hotKey: KeyboardShortcutHintHotKey,
): string;
export function renderKeyboardShortcutHint(
    {isAppleDevice}: {isAppleDevice: boolean},
    modKey: "mod",
    shiftOrHotKey: "shift" | KeyboardShortcutHintHotKey,
    hotKey?: KeyboardShortcutHintHotKey,
): string {
    if (hotKey === undefined) {
        return isAppleDevice ? `⌘+${shiftOrHotKey}` : `ctrl+${shiftOrHotKey}`;
    } else {
        return isAppleDevice ? `⌘+shift+${hotKey}` : `ctrl+shift+${hotKey}`;
    }
}

export type KeyboardShortcutHintHotKey =
    | "a"
    | "b"
    | "c"
    | "d"
    | "e"
    | "f"
    | "g"
    | "h"
    | "i"
    | "j"
    | "k"
    | "l"
    | "m"
    | "n"
    | "o"
    | "p"
    | "q"
    | "r"
    | "s"
    | "t"
    | "u"
    | "v"
    | "w"
    | "x"
    | "y"
    | "z"
    | "0"
    | "1"
    | "2"
    | "3"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"
    | "9"
    | "="
    | "-"
    | "["
    | "]"
    | "\\"
    | ";"
    // eslint-disable-next-line cyberworlds/string-quotes
    | "'"
    | ","
    | "."
    | "/"
    | "enter";
