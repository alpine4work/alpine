import emojiRegex from "emoji-regex";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";

/**
 * Iterate through all emojis in a string.
 *
 * Uses [`emoji-regex`][1] but filters out emojis that [present as text][2].
 *
 * [1]: https://www.npmjs.com/package/emoji-regex
 * [2]: https://unicode.org/emoji/charts/emoji-variants.html
 */
export function iterateEmojis(string: string): Iterable<{index: number; emoji: string}> {
    return filterMapIterable(string.matchAll(emojiRegex()), match => {
        const index = match.index;
        let emoji = match[0];

        // It would appear that `emoji-regex` has a bug where it does not consider emojis
        // that end in the text variant selector as an emoji. However
        // `text_presentation_sequence` is a valid form in the spec we'd like to consider:
        // http://unicode.org/reports/tr51/#Emoji_Presentation
        if (/\p{Emoji}$/u.test(emoji) && string[index + emoji.length] === "\u{FE0E}")
            emoji += "\u{FE0E}";

        // We do not consider emojis that render as text to be emojis (unlike the
        // `emoji-regex` package).
        //
        // Filter out emojis that default to text presentation (characters that have the
        // `Emoji` character class but do not have the `Emoji_Presentation` character
        // class) and filter out emoji text presentation sequences (an `Emoji` character
        // class followed by U+FE0E) ([spec][1]).
        //
        // More information on this topic:
        //
        // - [Emojis with both emoji presentation and text presentations][2]
        // - [Variation selector Unicode code points][3]
        // - [Good blog post on OS presentation differences][4]
        // - [Another good blog post on OS presentation differences][5] (TL;DR of both of
        //   these is mobile Safari on iOS does something different than the Unicode
        //   specification when you don't have a variant selector)
        //
        // [1]: http://unicode.org/reports/tr51/#Emoji_Presentation
        // [2]: https://unicode.org/emoji/charts/emoji-variants.html
        // [3]: https://en.wikipedia.org/wiki/Variation_Selectors_(Unicode_block)
        // [4]: https://www.codejam.info/2021/11/emoji-variation-selector.html
        // [5]: https://css-tricks.com/text-that-sometimes-turns-to-emojis/
        if (/(?:(?=\p{Emoji})\P{Emoji_Presentation}(?!\uFE0F)|\p{Emoji}\uFE0E)/u.test(emoji))
            return;

        return {index, emoji};
    });
}
