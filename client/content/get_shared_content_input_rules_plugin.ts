import {InputRule, inputRules, smartQuotes} from "prosemirror-inputrules";

export function getSharedContentInputRulesPlugin() {
    const sharedContentInputRules: Array<InputRule> = [];

    // "smart quotes"
    sharedContentInputRules.push(...smartQuotes);

    // Emojis should be either at the beginning of the block or should come after
    // a space.
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(:\))$/, "\u{1F642}")); // 🙂 (https://graphemica.com/1F642)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(:\()$/, "\u{1F615}")); // 😕 (https://graphemica.com/1F615)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(;\))$/, "\u{1F609}")); // 😉 (https://graphemica.com/1F609)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(:D)$/, "\u{1F600}")); // 😀 (https://graphemica.com/1F600)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(:P)$/, "\u{1F61B}")); // 😛 (https://graphemica.com/1F61B)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(:O)$/, "\u{1F62E}")); // 😮 (https://graphemica.com/1F62E)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(<3)$/, "\u{2764}\u{FE0F}")); // ❤️ (https://graphemica.com/2764 and https://graphemica.com/FE0F)
    sharedContentInputRules.push(new InputRule(/(?:^|\s)(\+\+)$/, "\u{1F44D}")); // 👍 (https://graphemica.com/1F44D)

    // Misc glyphs
    sharedContentInputRules.push(new InputRule(/--$/, "\u{2014}")); // em dash (https://graphemica.com/2014)
    sharedContentInputRules.push(new InputRule(/\.\.\.$/, "\u{2026}")); // ellipsis (https://graphemica.com/2026)
    sharedContentInputRules.push(new InputRule(/->$/, "\u{2192}")); // rightwards arrow (https://graphemica.com/2192)
    sharedContentInputRules.push(new InputRule(/<-$/, "\u{2190}")); // leftwards arrow (https://graphemica.com/2190)
    sharedContentInputRules.push(new InputRule(/\^2$/, "\u{00B2}")); // superscript two (https://graphemica.com/00B2)
    sharedContentInputRules.push(new InputRule(/\^3$/, "\u{00B3}")); // superscript three (https://graphemica.com/00B3)
    sharedContentInputRules.push(new InputRule(/\^(?:tm|TM)$/, "\u{2122}")); // trademark (https://graphemica.com/2122)

    return sharedContentInputRules;
}

export function buildSharedContentInputRulesPlugin() {
    const rules = getSharedContentInputRulesPlugin();
    return inputRules({rules});
}
