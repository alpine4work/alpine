import {ReactNode} from "react";
import {emojiFontFamily} from "~/client/web/styles/styles.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";

/**
 * Render some text to React but make sure any emojis are wrapped in `<span>`s
 * with `emojiFontFamily`.
 */
export function renderTextWithEmojiFontFamily(text: string): string | Array<ReactNode> {
    const nodes: Array<ReactNode> = [];

    const emojis = Array.from(iterateEmojis(text));
    if (emojis.length === 0) return text;

    let lastIndex = 0;
    for (const {index, emoji} of emojis) {
        const textSlice = text.slice(lastIndex, index);
        if (textSlice.length === 0) continue;

        nodes.push(textSlice);
        nodes.push(
            <span key={index} style={{fontFamily: emojiFontFamily}}>
                {emoji}
            </span>,
        );

        lastIndex = index + emoji.length;
    }

    const textSlice = text.slice(lastIndex);
    if (textSlice.length > 0) nodes.push(textSlice);

    return nodes;
}
