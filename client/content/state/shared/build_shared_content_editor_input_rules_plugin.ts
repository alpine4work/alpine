import {InputRule, inputRules} from "prosemirror-inputrules";
import {EditorState} from "prosemirror-state";
import {
    isContentEditorRetypingInputRule,
    trackContentEditorRetypedInputRule,
} from "~/client/content/state/content_editor_state.js";
import {generateId} from "~/shared/id/id.js";

/**
 * Forked from [ProseMirror's default input rule `stringHandler`][1] with a
 * couple additions.
 *
 * - Doesn't apply the input rule in a code block.
 *
 * - If the input rule is applied, then the user deletes it and retypes the
 *   exact same string then we don't apply the input rule again. This is
 *   essential on mobile where the user can't press cmd-z to quick undo the
 *   input rule.
 *
 * [1]: https://github.com/ProseMirror/prosemirror-inputrules/blob/8433778a3ce4e45c0188341b72fd71da3a440b5b/src/inputrules.ts#L53-L68
 */
function createStandardStringHandler(string: string) {
    const inputRuleId = generateId();

    return (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        if (isContentEditorRetypingInputRule(state, inputRuleId)) {
            return null;
        }

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

        let transaction = state.tr.insertText(insert, start, end);

        transaction = trackContentEditorRetypedInputRule(transaction, {
            inputRuleId,
            replacementStart: start,
            replacementString: insert,
            replacedString: match[1] ?? match[0],
        });

        return transaction;
    };
}

/**
 * Create an `InputRule` with a standard configuration for our content editor.
 *
 * See `createStandardStringHandler()` for more information.
 */
function createStandardInputRule(regExp: RegExp, string: string) {
    return new InputRule(regExp, createStandardStringHandler(string));
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

    const emojiMap: Array<[string, string]> = [
        [":\\)", "\u{1F642}"], // 🙂 (https://graphemica.com/1F642)
        [":\\(", "\u{1F615}"], // 😕 (https://graphemica.com/1F615)
        [";\\)", "\u{1F609}"], // 😉 (https://graphemica.com/1F609)
        [":\\\\", "\u{1F615}"], // 😕 (https://graphemica.com/1F615)
        [":\\/", "\u{1F615}"], // 😕 (https://graphemica.com/1F615)
        [":\\|", "\u{1F610}"], // 😐 (https://graphemica.com/1F610)
        [":D", "\u{1F600}"], // 😀 (https://graphemica.com/1F600)
        [":P", "\u{1F61B}"], // 😛 (https://graphemica.com/1F61B)
        [":O", "\u{1F62E}"], // 😮 (https://graphemica.com/1F62E)
        ["<3", "\u{2764}\u{FE0F}"], // ❤️ (https://graphemica.com/2764 and https://graphemica.com/FE0F)
        ["\\+\\+", "\u{1F44D}"], // 👍 (https://graphemica.com/1F44D)
        [":joy:", "\u{1F602}"], // 😂 (https://graphemica.com/1F602)
        [":thinking:", "\u{1F914}"], // 🤔 (https://graphemica.com/1F914)
        [":tada:", "\u{1F389}"], // 🎉 (https://graphemica.com/1F389)
        [":brain:", "\u{1F9E0}"], // 🧠 (https://graphemica.com/1F9E0)
        [":eyes:", "\u{1F440}"], // 👀 (https://graphemica.com/1F440)
        [":exploding_head:", "\u{1F92F}"], // 🤯 (https://graphemica.com/1F92F)
        [":fire:", "\u{1F525}"], // 🔥 (https://graphemica.com/1F525)
        [":muscle:", "\u{1F4AA}"], // 💪 (https://graphemica.com/1F4AA)
        [":white_check_mark:", "\u{2705}"], // ✅ (https://graphemica.com/2705)
        [":check:", "\u{2705}"], // ✅ (https://graphemica.com/2705)
        [":sparkles:", "\u{2728}"], // ✨ (https://graphemica.com/2728)
        [":pray:", "\u{1F64F}"], // 🙏 (https://graphemica.com/1F64F)
        [":100:", "\u{1F4AF}"], // 💯 (https://graphemica.com/1F4AF)
    ];

    // Emojis should be either at the beginning of the block or should come after
    // a space.
    for (const [match, emoji] of emojiMap) {
        rules.push(createStandardInputRule(new RegExp(`(?:^|\\s)(${match})$`), emoji));
    }

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
