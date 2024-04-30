import {InputRule, inputRules, smartQuotes} from "prosemirror-inputrules";

export function getSharedInputRules() {
    const sharedInputRules: Array<InputRule> = [];

    // "smart quotes"
    sharedInputRules.push(...smartQuotes);

    // Emojis should be either at the beginning of the block or should come after
    // a space.
    sharedInputRules.push(new InputRule(/(?:^|\s)(:\))$/, "\u{1F642}")); // 🙂 (https://graphemica.com/1F642)
    sharedInputRules.push(new InputRule(/(?:^|\s)(:\()$/, "\u{1F615}")); // 😕 (https://graphemica.com/1F615)
    sharedInputRules.push(new InputRule(/(?:^|\s)(;\))$/, "\u{1F609}")); // 😉 (https://graphemica.com/1F609)
    sharedInputRules.push(new InputRule(/(?:^|\s)(:D)$/, "\u{1F600}")); // 😀 (https://graphemica.com/1F600)
    sharedInputRules.push(new InputRule(/(?:^|\s)(:P)$/, "\u{1F61B}")); // 😛 (https://graphemica.com/1F61B)
    sharedInputRules.push(new InputRule(/(?:^|\s)(:O)$/, "\u{1F62E}")); // 😮 (https://graphemica.com/1F62E)
    sharedInputRules.push(new InputRule(/(?:^|\s)(<3)$/, "\u{2764}\u{FE0F}")); // ❤️ (https://graphemica.com/2764 and https://graphemica.com/FE0F)
    sharedInputRules.push(new InputRule(/(?:^|\s)(\+\+)$/, "\u{1F44D}")); // 👍 (https://graphemica.com/1F44D)

    return sharedInputRules;
}

export function buildSharedInputRulesPlugin() {
    const rules: Array<InputRule> = [];
    const sharedInputRules = getSharedInputRules();
    rules.push(...sharedInputRules);

    return inputRules({rules});
}
