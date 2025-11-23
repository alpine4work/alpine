import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";

/**
 * Messages comprised only of a small number of emoji we render as larger
 * without a message bubble.
 */
export function shouldDisplayTextAsBigEmojiMessage(string: string): boolean {
    let emojiCount = 0;
    let stringPosition = 0;

    for (const {emoji} of iterateEmojis(string)) {
        // An excessive number of emojis are treated as a regular message.
        if (emojiCount >= 25) return false;

        // Spaces are allowed in a big emoji string. Skip over any spaces
        // between emojis.
        stringPosition +=
            string.slice(stringPosition).match(/^\p{Space_Separator}*/u)?.[0].length ?? 0;

        // The string must be comprised entirely of emoji matches. If there is some
        // other text in between then we don't want to render as a big emoji message.
        if (!string.startsWith(emoji, stringPosition)) return false;

        emojiCount++;
        stringPosition += emoji.length;
    }

    // Spaces are allowed in a big emoji string. Skip over any spaces
    // between emojis.
    stringPosition += string.slice(stringPosition).match(/^\p{Space_Separator}*/u)?.[0].length ?? 0;

    // May not contain non-space characters after the emoji.
    if (stringPosition !== string.length) return false;

    return emojiCount > 0;
}
