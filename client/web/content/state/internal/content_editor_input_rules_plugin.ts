import {
    InputRule,
    inputRules,
    textblockTypeInputRule,
    wrappingInputRule,
} from "prosemirror-inputrules";
import {MarkType, NodeType} from "prosemirror-model";
import {TextSelection} from "prosemirror-state";
import {findWrapping} from "prosemirror-transform";
import {openContentEditorMentionFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {addSharedContentEditorInputRules} from "~/client/web/content/state/shared/build_shared_content_editor_input_rules_plugin.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function buildContentEditorInputRulesPlugin(schema: ContentProsemirrorSchema) {
    const rules: Array<InputRule> = [];

    // get "smart quotes" and emoji shared input rules
    addSharedContentEditorInputRules(rules);

    // `@` opens a mention search/selector interface
    rules.push(
        // Allow mention after after whitespace, opening brackets, or opening quotes
        new InputRule(/(?:^|\s|\p{Ps}|["'`\u201c\u2018])@$/u, state => {
            const {$from, $to} = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

            // Don't open the mention floater if we're in a code block.
            if (
                $from.node().type.name === "codeBlockLine" ||
                $to.node().type.name === "codeBlockLine"
            ) {
                return null;
            }

            return state.tr
                .replaceSelectionWith(schema.text("@"))
                .setMeta(openContentEditorMentionFloaterMetaKey, true);
        }),
    );

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
    rules.push(
        listItemInputRule(/^\s*([1-9][0-9]*)\.\s$/, schema.nodes.orderedListItem, match => {
            const orderStart = parseInt(match[1]!);
            return {orderStart: orderStart > 1 ? orderStart : null};
        }),
    );

    // `[] ` or `[ ] ` creates a check list item
    if (schema.nodes.checkListItem) {
        rules.push(listItemInputRule(/^\s*\[\s*\]\s$/, schema.nodes.checkListItem));
    }

    function listItemInputRule(
        regExp: RegExp,
        nodeType: NodeType,
        getAttrs: (match: RegExpMatchArray) => Record<string, unknown> = () => ({}),
    ) {
        return new InputRule(regExp, (state, match, start, end) => {
            // 1. Delete the matched text.
            const transaction = state.tr.delete(start, end);

            // 2. Try to find a valid way to wrap the cursor with our list item
            //    node type.
            const $start = transaction.doc.resolve(start);
            const range = $start.blockRange();
            if (!range) return null;

            const wrapping = findWrapping(
                range,
                nodeType,
                // We intentionally only use `getAttrs()` here when wrapping. If you're
                // changing the `listItem` node type then we use default attrs.
                //
                // In practice, this means `orderedListItem` sets `orderStart` if you're
                // creating a new list item but not when converting an existing list item to
                // an ordered list.
                getAttrs(match),
            );

            // 3. If there's a valid wrapping then apply it.
            if (wrapping) {
                transaction.wrap(range, wrapping);
                return transaction;
            }

            // 4. If we are already in a list item then we convert the type of the
            //    list item while preserving the indentation level.
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
    rules.push(codeBlockInputRule(/^```$/, schema.nodes.codeBlock));

    function codeBlockInputRule(regExp: RegExp, nodeType: NodeType) {
        return new InputRule(regExp, (state, _match, start, end) => {
            const {tr: transaction, schema} = state;
            const $start = state.doc.resolve(start);

            if (
                !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)
            ) {
                return null;
            }

            if (!schema.nodes.codeBlock || !schema.nodes.codeBlockLine) {
                return null;
            }

            const codeBlockNode = assertExists(schema.nodes.codeBlock.createAndFill());

            transaction.replaceRangeWith(start, end, codeBlockNode);

            const newBlockStartPos = start + 1;
            transaction.setSelection(TextSelection.create(transaction.doc, newBlockStartPos));

            return transaction;
        });
    }

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
                            schema.nodes.divider,
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
                // We must either be at the beginning of the line, be after a space,
                // or be after an opening bracket.
                "(^|\\s|\\p{Ps})",
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
                // This must end at our cursor or at an ending bracket.
                "\\p{Pe}?$",
            ].join(""),
            // Allow unicode characters (like opening/closing bracket properties)
            "u",
        );

        return new InputRule(regExp, (state, match, start, end) => {
            const {$from} = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);
            const offset = match[1]!.length;
            const isInCodeBlockLine = $from.node().type.name === "codeBlockLine";

            if (isInCodeBlockLine) {
                return null;
            }

            return state.tr
                .delete(start + offset, start + offset + 1)
                .addMark(start + offset, end - offset, markType.create());
        });
    }

    return inputRules({rules});
}
