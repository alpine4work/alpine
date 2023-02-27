import {
    InputRule,
    inputRules,
    smartQuotes,
    textblockTypeInputRule,
    wrappingInputRule,
} from "prosemirror-inputrules";
import {MarkType, NodeType} from "prosemirror-model";
import {findWrapping} from "prosemirror-transform";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema";
import {assert} from "~/shared/helpers/control/assert";

export const openMentionFloaterMetaKey = "openMentionFloater";

export function buildInputRulesPlugin(schema: ContentProsemirrorSchema) {
    const rules: Array<InputRule> = [];

    // `@` opens a mention search/selector interface
    rules.push(
        new InputRule(/(?:^|\s)@$/, state =>
            state.tr
                .replaceSelectionWith(schema.text("@"))
                .setMeta(openMentionFloaterMetaKey, true),
        ),
    );

    // "smart quotes"
    rules.push(...smartQuotes);

    // `# `, `## `, or `### ` creates a heading
    if (schema.nodes.heading) {
        rules.push(
            textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, match => ({
                level: match[1]!.length,
            })),
        );
    }

    // `> ` creates a quote block
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.quoteBlock));

    // `- ` or `* ` creates a bullet list item
    rules.push(listItemInputRule(/^\s*[-*]\s$/, schema.nodes.unorderedListItem));

    // `1. ` creates an ordered list item
    rules.push(listItemInputRule(/^\s*1\.\s$/, schema.nodes.orderedListItem));

    // `[] ` or `[ ] ` creates a check list item
    if (schema.nodes.checkListItem) {
        rules.push(listItemInputRule(/^\s*\[\s*\]\s$/, schema.nodes.checkListItem));
    }

    function listItemInputRule(regExp: RegExp, nodeType: NodeType) {
        return new InputRule(regExp, (state, _match, start, end) => {
            // 1. Delete the matched text.
            const transaction = state.tr.delete(start, end);

            // 2. Try to find a valid way to wrap the cursor with our list item
            // node type.
            const $start = transaction.doc.resolve(start);
            const range = $start.blockRange();
            if (!range) return null;
            const wrapping = findWrapping(range, nodeType, {});

            // 3. If there's a valid wrapping then apply it.
            if (wrapping) {
                transaction.wrap(range, wrapping);
                return transaction;
            }

            // 4. If we are already in a list item then we convert the type of the
            // list item while preserving the indentation level.
            const listItemNode = $start.node(-1);
            if (!listItemNode || !listItemNode.type.groups.includes("listItem")) {
                return null;
            }
            transaction.setNodeMarkup(start - 2, nodeType, {
                indent: listItemNode.attrs.indent,
            });
            return transaction;
        });
    }

    // ``` creates a code block
    rules.push(textblockTypeInputRule(/^```$/, schema.nodes.codeBlock));

    // `---` creates a divider
    if (schema.nodes.divider) {
        rules.push(
            new InputRule(/^(?:--|\u2014)-$/u, (state, _match, start, end) => {
                const $start = state.doc.resolve(start);
                const $end = state.doc.resolve(end);

                const isEndOfParent = $end.parentOffset === $end.parent.content.size;

                // If you type `---|test` (where `|` is your cursor) then we don't want to
                // insert a divider.
                if (!isEndOfParent) {
                    return null;
                }

                // Make sure we can insert a divider at this location. We can't insert a
                // divider in a list item or quote block for instance.
                if (
                    !$start
                        .node(-1)
                        .canReplaceWith(
                            $start.index(-1),
                            $start.indexAfter(-1),
                            schema.nodes.divider!,
                        )
                ) {
                    return null;
                }

                const transaction = state.tr.replaceWith(
                    // Start will always be the first text position in the block. So by
                    // subtracting one we get the first block position.
                    start - 1,
                    // Replacing to `end + 1` will replace the entire block.
                    end + 1,

                    schema.node("divider"),
                );

                const isEndOfDoc = state.doc.content.size - 1 === end;

                // If we are inserting a divider at the end of the document then we want
                // to insert a paragraph after the divider so the user may continue
                // typing.
                if (isEndOfDoc) {
                    transaction.insert(start, schema.node("paragraph"));
                }

                return transaction;
            }),
        );
    }

    // Markdown-style bracket rules
    //
    // We use `*` for bold instead of `**` which is the typical Markdown syntax.
    // This will probably drive developers insane since it isn't Markdown spec
    // compliant. I know it drove me insane when I first saw it in Slack. However,
    // the set of power users is larger than the set of power users that care
    // about Markdown compatibility. A single asterisk is much more convenient
    // without any legacy attachment to Markdown.
    rules.push(markdownBracketInputRule("*", schema.marks.bold));
    rules.push(markdownBracketInputRule("_", schema.marks.italic));
    rules.push(markdownBracketInputRule("~", schema.marks.strike));
    rules.push(markdownBracketInputRule("`", schema.marks.code));

    function markdownBracketInputRule(char: string, markType: MarkType) {
        assert(char.length === 1);
        const escapedChar = char === "*" ? `\\${char}` : char;

        const regExp = new RegExp(
            [
                // We must either be at the beginning of the line or we must be after
                // a space.
                "(^|\\s)",
                // The opening bracket.
                escapedChar,
                // Open group...
                "(?:",
                // Could match a single character that is both:
                //
                // - Not our bracket character
                // - Not a space
                `[^${char}\\s]`,
                // Or...
                "|",
                // Match two or more characters. The characters next to the brackets
                // must not be spaces. All characters within the brackets must not be
                // the bracket character itself.
                `[^${char}\\s][^${char}]*[^${char}\\s]`,
                // Close group...
                ")",
                // The closing bracket.
                escapedChar,
                // This must end at our cursor.
                "$",
            ].join(""),
        );

        return new InputRule(regExp, (state, match, start, end) => {
            const offset = match[1]!.length;
            return state.tr
                .delete(start + offset, start + offset + 1)
                .addMark(start + offset, end, markType.create());
        });
    }

    // Misc glyphs
    rules.push(new InputRule(/--$/, "\u{2014}")); // em dash (https://graphemica.com/2014)
    rules.push(new InputRule(/\.\.\.$/, "\u{2026}")); // ellipsis (https://graphemica.com/2026)
    rules.push(new InputRule(/->$/, "\u{2192}")); // rightwards arrow (https://graphemica.com/2192)
    rules.push(new InputRule(/<-$/, "\u{2190}")); // leftwards arrow (https://graphemica.com/2190)
    rules.push(new InputRule(/\^2$/, "\u{00B2}")); // superscript two (https://graphemica.com/00B2)
    rules.push(new InputRule(/\^3$/, "\u{00B3}")); // superscript three (https://graphemica.com/00B3)
    rules.push(new InputRule(/\^(?:tm|TM)$/, "\u{2122}")); // trademark (https://graphemica.com/2122)

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

    return inputRules({rules});
}
