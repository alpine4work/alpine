import {InputRule, inputRules} from "prosemirror-inputrules";
import {EditorState} from "prosemirror-state";

// Forked from ProseMirror's `stringHandler` except adds logic to not apply
// input rule in code block.
//
// https://github.com/ProseMirror/prosemirror-inputrules/blob/8433778a3ce4e45c0188341b72fd71da3a440b5b/src/inputrules.ts#L53-L68
function createStringHandlerWithoutCodeBlock(string: string) {
    return (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        // If we are inside a code block, we do not want smart quotes
        const isInCodeBlockLine = state.selection.$from.node().type.name === "codeBlockLine";
        if (isInCodeBlockLine) {
            return null;
        }

        let insert = string;
        if (match[1]) {
            const offset = match[0].lastIndexOf(match[1]);
            insert += match[0].slice(offset + match[1].length);
            start += offset;
            const cutOff = start - end;
            if (cutOff > 0) {
                insert = match[0].slice(offset - cutOff, offset) + insert;
                start = end;
            }
        }
        return state.tr.insertText(insert, start, end);
    };
}

/**
 * Create an `InputRule` with a standard configuration for our content editor.
 * Namely input rules shouldn't apply in code blocks.
 */
function createStandardInputRule(regExp: RegExp, string: string) {
    return new InputRule(regExp, createStringHandlerWithoutCodeBlock(string));
}

export function addSharedContentEditorInputRules(rules: Array<InputRule>) {
    // Smart Quotes
    //
    // We fork these input rules from Prosemirror's prosemirror-inputrules to
    // add our own custom behavior for smart quotes in code blocks and paragraphs.
    //
    // https://github.com/ProseMirror/prosemirror-inputrules/blob/8433778a3ce4e45c0188341b72fd71da3a440b5b/src/rules.ts#L7-L17
    rules.push(createStandardInputRule(/(?:^|[\s{[(<'"\u2018\u201C])(")$/, "“"));
    rules.push(createStandardInputRule(/"$/, "”"));
    rules.push(createStandardInputRule(/(?:^|[\s{[(<'"\u2018\u201C])(')$/, "‘"));
    rules.push(createStandardInputRule(/'$/, "’"));

    // Emojis should be either at the beginning of the block or should come after
    // a space.
    rules.push(createStandardInputRule(/(?:^|\s)(:\))$/, "\u{1F642}")); // 🙂 (https://graphemica.com/1F642)
    rules.push(createStandardInputRule(/(?:^|\s)(:\()$/, "\u{1F615}")); // 😕 (https://graphemica.com/1F615)
    rules.push(createStandardInputRule(/(?:^|\s)(;\))$/, "\u{1F609}")); // 😉 (https://graphemica.com/1F609)
    rules.push(createStandardInputRule(/(?:^|\s)(:D)$/, "\u{1F600}")); // 😀 (https://graphemica.com/1F600)
    rules.push(createStandardInputRule(/(?:^|\s)(:P)$/, "\u{1F61B}")); // 😛 (https://graphemica.com/1F61B)
    rules.push(createStandardInputRule(/(?:^|\s)(:O)$/, "\u{1F62E}")); // 😮 (https://graphemica.com/1F62E)
    rules.push(createStandardInputRule(/(?:^|\s)(<3)$/, "\u{2764}\u{FE0F}")); // ❤️ (https://graphemica.com/2764 and https://graphemica.com/FE0F)
    rules.push(createStandardInputRule(/(?:^|\s)(\+\+)$/, "\u{1F44D}")); // 👍 (https://graphemica.com/1F44D)

    // Misc glyphs
    rules.push(createStandardInputRule(/--$/, "\u{2014}")); // em dash (https://graphemica.com/2014)
    rules.push(createStandardInputRule(/\.\.\.$/, "\u{2026}")); // ellipsis (https://graphemica.com/2026)
    rules.push(createStandardInputRule(/->$/, "\u{2192}")); // rightwards arrow (https://graphemica.com/2192)
    rules.push(createStandardInputRule(/<-$/, "\u{2190}")); // leftwards arrow (https://graphemica.com/2190)
    rules.push(createStandardInputRule(/\^2$/, "\u{00B2}")); // superscript two (https://graphemica.com/00B2)
    rules.push(createStandardInputRule(/\^3$/, "\u{00B3}")); // superscript three (https://graphemica.com/00B3)
    rules.push(createStandardInputRule(/\^(?:tm|TM)$/, "\u{2122}")); // trademark (https://graphemica.com/2122)

    return rules;
}

export function buildSharedContentEditorInputRulesPlugin() {
    const rules: Array<InputRule> = [];
    addSharedContentEditorInputRules(rules);

    return inputRules({rules});
}
