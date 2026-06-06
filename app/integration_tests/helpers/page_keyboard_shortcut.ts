import {type Page} from "@playwright/test";
import {isAppleDevicePage} from "~/app/integration_tests/helpers/is_apple_device_page.js";

// Designed to use the same parameters as `renderKeyboardShortcutHint()`.
export async function pageKeyboardShortcut(
    page: Page,
    modKey: "mod",
    hotKey: PageKeyboardShortcutHotKey,
): Promise<string>;
export async function pageKeyboardShortcut(
    page: Page,
    modKey: "mod",
    shiftKey: "shift",
    hotKey: PageKeyboardShortcutHotKey,
): Promise<string>;
export async function pageKeyboardShortcut(
    page: Page,
    modKey: "mod",
    shiftOrHotKey: "shift" | PageKeyboardShortcutHotKey,
    hotKey?: PageKeyboardShortcutHotKey,
): Promise<string> {
    const isAppleDevice = await isAppleDevicePage(page);
    const modifier = isAppleDevice ? "Meta" : "Control";

    if (hotKey === undefined) {
        return `${modifier}+${capitalize(shiftOrHotKey)}`;
    } else {
        return `${modifier}+Shift+${capitalize(hotKey)}`;
    }
}

function capitalize(shiftOrHotKey: "shift" | PageKeyboardShortcutHotKey): string {
    if (shiftOrHotKey === "shift") return "Shift";
    if (shiftOrHotKey === "enter") return "Enter";
    if (shiftOrHotKey === "left") return "ArrowLeft";
    if (shiftOrHotKey === "right") return "ArrowRight";
    if (shiftOrHotKey === "up") return "ArrowUp";
    if (shiftOrHotKey === "down") return "ArrowDown";
    return shiftOrHotKey;
}

// TODO(calebmer): Ideally this would be a shared type with
// `renderKeyboardShortcutHint()`.
export type PageKeyboardShortcutHotKey =
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
    | "enter"
    | "left"
    | "right"
    | "up"
    | "down";
