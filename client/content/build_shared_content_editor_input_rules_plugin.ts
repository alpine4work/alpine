import {InputRule, inputRules, smartQuotes} from "prosemirror-inputrules";

function buildSharedContentInputRules(rules: Array<InputRule>) {
    // "smart quotes"
    rules.push(...smartQuotes);

    // Emojis should be either at the beginning of the block or should come after
    // a space.
    rules.push(new InputRule(/(?:^|\s)(:\))$/, "\u{1F642}")); // 🙂 (https://graphemica.com/1F642)
    rules.push(new InputRule(/(?:^|\s)(:\()$/, "\u{1F615}")); // 😕 (https://graphemica.com/1F615)
    rules.push(new InputRule(/(?:^|\s)(;\))$/, "\u{1F609}")); // 😉 (https://graphemica.com/1F609)
    rules.push(new InputRule(/(?:^|\s)(:D)$/, "\u{1F600}")); // 😀 (https://graphemica.com/1F600)
    rules.push(new InputRule(/(?:^|\s)(:P)$/, "\u{1F61B}")); // 😛 (https://graphemica.com/1F61B)
    rules.push(new InputRule(/(?:^|\s)(:O)$/, "\u{1F62E}")); // 😮 (https://graphemica.com/1F62E)
    rules.push(new InputRule(/(?:^|\s)(<3)$/, "\u{2764}\u{FE0F}")); // ❤️ (https://graphemica.com/2764 and https://graphemica.com/FE0F)
    rules.push(new InputRule(/(?:^|\s)(\+\+)$/, "\u{1F44D}")); // 👍 (https://graphemica.com/1F44D)

    // Misc glyphs
    rules.push(new InputRule(/--$/, "\u{2014}")); // em dash (https://graphemica.com/2014)
    rules.push(new InputRule(/\.\.\.$/, "\u{2026}")); // ellipsis (https://graphemica.com/2026)
    rules.push(new InputRule(/->$/, "\u{2192}")); // rightwards arrow (https://graphemica.com/2192)
    rules.push(new InputRule(/<-$/, "\u{2190}")); // leftwards arrow (https://graphemica.com/2190)
    rules.push(new InputRule(/\^2$/, "\u{00B2}")); // superscript two (https://graphemica.com/00B2)
    rules.push(new InputRule(/\^3$/, "\u{00B3}")); // superscript three (https://graphemica.com/00B3)
    rules.push(new InputRule(/\^(?:tm|TM)$/, "\u{2122}")); // trademark (https://graphemica.com/2122)

    return rules;
}

export function buildSharedContentEditorInputRulesPlugin() {
    const rules: Array<InputRule> = [];
    buildSharedContentInputRules(rules);

    return inputRules({rules});
}
