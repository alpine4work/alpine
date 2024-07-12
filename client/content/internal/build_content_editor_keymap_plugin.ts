import {
    chainCommands,
    deleteSelection,
    joinBackward,
    joinForward,
    liftEmptyBlock,
    selectAll,
    selectNodeBackward,
    selectNodeForward,
    splitBlock,
} from "prosemirror-commands";
import {redo, undo} from "prosemirror-history";
import {undoInputRule} from "prosemirror-inputrules";
import {keydownHandler} from "prosemirror-keymap";
import {Node} from "prosemirror-model";
import {EditorState, Plugin, Selection, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {contentEditorQuickUndoCommand} from "~/client/content/content_editor_state.js";
import {getContentCodeBlockLineAdjacentIndentationSpaceCount} from "~/client/content/internal/get_content_code_block_line_adjacent_indentation_space_count.js";
import {createToggleMarkCommand} from "~/client/content/internal/helpers/create_toggle_mark_command.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/content/internal/helpers/indent_and_dedent_list_item_commands.js";
import {splitBlockWithCodeBlockLineLeadingIndentation} from "~/client/content/internal/helpers/split_block_with_code_block_line_leading_indentation.js";
import {addSharedContentEditorKeymapCommands} from "~/client/content/shared/add_shared_content_editor_keymap_commands.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentProsemirrorSchema,
    contentCodeBlockIndentationSpaceCount,
} from "~/shared/content/content_schema.js";

type Command = (
    state: EditorState,
    transact?: (tr: Transaction) => void,
    view?: EditorView,
) => boolean;

function isNodeSpacesOnly(node: Node): boolean {
    for (let i = 0; i < node.childCount; i++) {
        const childNode = node.child(i);
        if (!childNode.isText) return false;
        if (/[^ ]/.test(childNode.text!)) return false;
    }
    return true;
}

function indentationToRemove(lineText: string): number {
    let indentationToRemove = 0;
    for (let i = 0; i < lineText.length; i++) {
        if (lineText[i] === " " && indentationToRemove < contentCodeBlockIndentationSpaceCount) {
            indentationToRemove++;
        } else {
            break;
        }
    }
    return indentationToRemove;
}

export const openKeyboardHighlightFloaterMetaKey = "openKeyboardHighlightFloater";
export const openKeyboardLinkFloaterMetaKey = "openKeyboardLinkFloater";
export const openCommentInputFloaterMetaKey = "openCommentInputFloater";

export function buildContentEditorKeymapPlugin(
    schema: ContentProsemirrorSchema,
    {disableUndoKeyboardShortcuts}: {disableUndoKeyboardShortcuts: boolean},
) {
    const keys = new Map<string, Command>();

    const quickUndoCommand = chainCommands(contentEditorQuickUndoCommand("Mod-z"), undoInputRule);

    // History
    if (!disableUndoKeyboardShortcuts) {
        keys.set("Mod-z", chainCommands(quickUndoCommand, undo));
        keys.set("Mod-shift-z", redo);
        keys.set("Mod-y", redo); // https://en.wikipedia.org/wiki/Control-Y
    } else {
        // Special behaviors of undo out of the undo stack should still work when
        // keyboard shortcuts are disabled. A rendering component will disable keyboard
        // shortcuts when it's managing its own undo stack. These changes are not part
        // of the undo stack.
        keys.set("Mod-z", quickUndoCommand);
    }

    const enterCommand: Command = chainCommands(
        // If "Enter" is pressed in an empty paragraph textblock which is wrapped
        // in another block then remove the wrapping.
        //
        // For example, if "Enter" is pressed in an empty quote we will convert
        // it to a paragraph.
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();
            const parentNode = $from.node($from.depth - 1);

            // If we are inside a `codeBlock` and `codeBlockLine` we DO NOT WANT
            // the`liftEmptyBlock` behavior to break the `codeBlock`, instead we
            // want to use `splitBlock`. `LiftEmptyBlock` behavior splits the
            // `codeBlock` into two separate codeBlocks.
            //
            // For example (behavior we do not want): if the cursor is at `|`:
            //
            // ```
            //  1
            //  2
            //  3 |
            // ```
            //
            // Then you press enter:
            // ```
            // 1
            // 2
            //
            // 1 |
            // ```
            if (
                node.type.name === "codeBlockLine" &&
                parentNode.type.name === "codeBlock" &&
                $from.node() === $to.node()
            ) {
                return false;
            }

            return liftEmptyBlock(state, dispatch);
        },

        // If "Enter" is pressed in an empty non-paragraph textblock (like a
        // header) then we want to convert that textblock back to a paragraph.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // # |
        // ```
        //
        // Then you press enter:
        //
        // ```
        // |
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();

            // 1. Should be an empty non-paragraph textblock (e.g. header).
            if (
                node.isTextblock === false ||
                node.content.size > 0 ||
                node.type.name === "paragraph" ||
                // Don't replace a node that can't be replaced with a paragraph. For example,
                // `codeBlockLine` in `codeBlock` can't be replaced with a paragraph.
                !$from
                    .node($from.depth - 1)
                    .canReplaceWith(
                        $from.index($from.depth - 1),
                        $from.index($from.depth - 1) + 1,
                        schema.nodes.paragraph,
                    )
            ) {
                return false;
            }

            // 2. Convert the textblock to a paragraph.
            if (dispatch) {
                dispatch(state.tr.setBlockType($from.pos, $to.pos, schema.nodes.paragraph));
            }
            return true;
        },

        // When pressing enter in a list item we should create a new list item.
        // The most basic version of this creates a new list item at the end
        // of the current one.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // - test|
        // ```
        //
        // Then you press enter:
        //
        // ```
        // - test
        // - |
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            // 1. Only create a new list item if "from" is in a list item.
            const listItemNode = $from.node(-1);
            if (!listItemNode || !listItemNode.type.groups.includes("listItem")) {
                return false;
            }

            // 2. Inherit only indentation from the current list item.
            const types = [
                {
                    type: listItemNode.type,
                    attrs: {indent: listItemNode.attrs.indent},
                },
            ];

            // 3. Delete the current selection when creating a list item.
            if (dispatch) {
                dispatch(
                    state.tr.delete($from.pos, $to.pos).split($from.pos, 2, types).scrollIntoView(),
                );
            }
            return true;
        },

        // If you're at the last line in a code block that has more than 1 line and the
        // code block line is only spaces then we want to deleted the last line and
        // instead create a paragraph beneath the code block. This allows the user to
        // easily escape the code block and continue typing prose when they're done
        // editing.
        //
        // To intentionally create many empty lines at the end of a code block the user
        // needs to put content in the lines then delete that content.
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            if ($from.pos !== $to.pos) return false;

            const node = $from.node();
            if (node.type.name !== "codeBlockLine") return false;

            const parentNode = $from.node($from.depth - 1);
            if (parentNode.childCount < 2) return false;

            const index = $from.index($from.depth - 1);
            if (index !== parentNode.childCount - 1) return false;

            if (!isNodeSpacesOnly(node)) return false;

            if (dispatch) {
                const before = $from.before();
                const after = $from.after();

                const transaction = state.tr
                    .deleteRange(before, after)
                    .replaceRangeWith(before + 1, before + 1, state.schema.node("paragraph"));

                dispatch?.(
                    transaction.setSelection(
                        new TextSelection(transaction.doc.resolve(before + 2)),
                    ),
                );
            }
            return true;
        },

        // Create a new node by splitting the current block at the cursor. If the
        // cursor is at the end of the block this will simply create a new block.
        // If the cursor is in the middle of the block it will split the block
        // in two.
        (state, dispatch) => {
            const {$from} = state.selection;
            const fromNode = $from.node();
            const isSelectionInCodeBlockLine = fromNode.type.name === "codeBlockLine";

            if (isSelectionInCodeBlockLine) {
                // If we're in a code block then we want to preserve the indentation level of
                // the line we're currently on. So if this is a code block and `|` is the
                // cursor:
                //
                // ```
                //     test|
                // ```
                //
                // Hitting enter should give us:
                //
                // ```
                //     test
                //     |
                // ```
                return splitBlockWithCodeBlockLineLeadingIndentation(state, dispatch);
            } else {
                return splitBlock(state, dispatch);
            }
        },
    );

    // Enter and Shift-Enter do the same thing. That's because in some contexts
    // enter will send a message being composed by the content editor. If the
    // user wants to insert more lines, they can use Shift-Enter to avoid
    // sending the message.
    //
    // To insert single lines you may use Alt-Enter or Ctrl-Enter.
    keys.set("Enter", enterCommand);
    keys.set("Shift-Enter", enterCommand);

    // Pressing alt+enter creates a hard break (aka a new line). You can use
    // alt+enter to create a list item with multiple lines, for instance.
    const altEnterCommand: Command = (state, dispatch) => {
        if (dispatch) {
            dispatch(state.tr.replaceSelectionWith(schema.nodes.break.create()).scrollIntoView());
        }
        return true;
    };

    keys.set("Alt-Enter", altEnterCommand);
    keys.set("Ctrl-Enter", altEnterCommand);

    const backspaceCommand: Command = chainCommands(
        // This one is simple. If there is a selection, delete it. If the
        // selection ranges a couple nodes the delete will do the right thing.
        deleteSelection,

        // Run quick undos triggered with `Backspace`.
        contentEditorQuickUndoCommand("Backspace"),

        // If "Backspace" is pressed in an empty non-paragraph textblock (like a
        // header) then we want to convert that textblock back to a paragraph.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // # |
        // ```
        //
        // Then you press backspace:
        //
        // ```
        // |
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();

            // 1. Should be an empty non-paragraph textblock (e.g. header) and the
            // cursor should be at the beginning of the block.
            const isSelectionAtFirstOffsetOfTextblock =
                node.isTextblock &&
                node.type.name !== "paragraph" &&
                $from.pos === $to.pos &&
                $from.parentOffset === 0 &&
                $from
                    .node($from.depth - 1)
                    .canReplaceWith(
                        $from.index($from.depth - 1),
                        $from.index($from.depth - 1) + 1,
                        schema.nodes.paragraph,
                    );

            if (!isSelectionAtFirstOffsetOfTextblock) return false;

            // 2. Convert the textblock to a paragraph.
            if (dispatch) {
                dispatch(state.tr.setBlockType($from.pos, $to.pos, schema.nodes.paragraph));
            }
            return true;
        },

        // If "Backspace" is pressed at the beginning of a paragraph in a quote block
        // or list item then remove the styling and lift the paragraph out.
        //
        // For example if the cursor is at `|`:
        //
        // ```
        // > item 1
        // > |item 2
        // > item 3
        // ```
        //
        // Then you press backspace:
        //
        // ```
        // > item 1
        // |item 2
        // > item 3
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();
            const parentNode = $from.node($from.depth - 1);
            const beforeParentNode =
                $from.depth > 1
                    ? state.doc.resolve($from.before($from.depth - 1)).nodeBefore
                    : null;

            // 1. Should be an empty paragraph text block in a quote block and the cursor
            // should be at the beginning of the block.
            const isSelectionAtFirstOffsetOfParagraphInQuoteBlock =
                node.type.name === "paragraph" &&
                (parentNode.type.name === "quoteBlock" ||
                    (parentNode.type.groups.includes("listItem") &&
                        // If the previous node is a list item and we are the first paragraph in our
                        // list item, join with the last list item instead of removing the list item
                        // style entirely.
                        !(
                            beforeParentNode &&
                            beforeParentNode.type.groups.includes("listItem") &&
                            parentNode.firstChild === node
                        ))) &&
                $from.pos === $to.pos &&
                $from.parentOffset === 0;

            if (!isSelectionAtFirstOffsetOfParagraphInQuoteBlock) return false;

            // 2. Lift the paragraph out of the quote block.
            dispatch?.(state.tr.lift($from.blockRange()!, $from.depth - 2));
            return true;
        },

        // If we delete at the beginning of a paragraph that comes after a list
        // (or quote block) then merge the paragraph with the list's last bullet.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // - foo
        // |bar
        // ```
        //
        // Then you press backspace:
        //
        // ```
        // - foo|bar
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;

            // 1. Cursor should be at the beginning of the paragraph.
            const isSelectionAtFirstOffsetOfParagraph =
                $from.pos === $to.pos &&
                $from.parentOffset === 0 &&
                $from.node().type.name === "paragraph";

            if (!isSelectionAtFirstOffsetOfParagraph) return false;

            // 2. Paragraph should be after a list.
            const lastNode = state.doc.resolve($from.before()).nodeBefore;
            const isLastNodeListItemOrQuoteBlock =
                lastNode &&
                (lastNode.type.groups.includes("listItem") || lastNode.type.name === "quoteBlock");

            if (!isLastNodeListItemOrQuoteBlock) return false;

            // 3. Actually perform the delete.
            if (dispatch) {
                if (lastNode.content.size > 2) {
                    let textblockNode: Node | null = lastNode;
                    let depthToLastTextblockNode = 0;
                    while (textblockNode && !textblockNode.isTextblock) {
                        depthToLastTextblockNode++;
                        textblockNode = textblockNode.lastChild;
                    }

                    dispatch(
                        state.tr
                            .deleteRange($from.pos - depthToLastTextblockNode - 2, $from.pos)
                            .scrollIntoView(),
                    );
                } else {
                    // 4. If the list item is empty then our above transaction will
                    // delete the list item styling. So detect when the list is empty
                    // and wrap the paragraph in an identical list item before deleting.
                    dispatch(
                        state.tr
                            .wrap($from.blockRange()!, [lastNode])
                            .deleteRange($from.pos - 5, $from.pos - 1)
                            .scrollIntoView(),
                    );
                }
            }
            return true;
        },

        // We only want to delete the code block if the code block is empty,
        // has only one code block line, and if the selection is at
        // the beginning of the code block.
        // Also handles the case when deleting the code block at the top
        // of the document, below the title.
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const currentNode = $from.node();
            const parentNode = $from.node($from.depth - 1);

            const isSelectionAtFirstOffsetOfCodeBlockLine =
                $from.pos === $to.pos &&
                $from.parentOffset === 0 &&
                currentNode.type.name === "codeBlockLine";

            if (!isSelectionAtFirstOffsetOfCodeBlockLine) {
                return false;
            }

            const isCodeBlockLineEmpty = currentNode.childCount === 0;
            const isCodeBlockEmpty = parentNode.childCount === 1;

            if (!isCodeBlockEmpty || !isCodeBlockLineEmpty) {
                return false;
            }

            if (dispatch) {
                const transaction = state.tr.delete(
                    $from.before($from.depth - 1),
                    $to.after($from.depth - 1),
                );
                dispatch(transaction);
            }
            return true;
        },

        // If the cursor is at the beginning of a block and the user presses
        // backspace then join with the prior block.
        joinBackward,

        // NOTE: To be honest, I (Caleb) am not sure what this does, but it is in
        // the ProseMirror base keymap so I assume it is important.
        selectNodeBackward,
    );

    const wordBackspaceCommand: Command = chainCommands(
        // If we delete before a mention and the mention is not a short mention, update
        // the mention to a short mention. Another delete will delete the mention.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // @Caleb Meredith|
        // ```
        //
        // Then you press backspace:
        //
        // ```
        // @Caleb|
        // ```
        //
        // Then you press backspace again:
        //
        // ```
        // |
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;

            const isSelectionBeforeMentionNode =
                $from.pos === $to.pos && $from.nodeBefore?.type.name === "mention";

            if (!isSelectionBeforeMentionNode) return false;

            const mention: ContentMention = $from.nodeBefore.attrs.mention;
            if (mention.isShort) return false;

            if (dispatch) {
                const newMention: ContentMention = {...mention, isShort: true};
                dispatch(state.tr.setNodeAttribute($from.pos - 1, "mention", newMention));
            }
            return true;
        },

        // If you hit backspace in a code block line within indentation spaces for the
        // line, we want to delete a level of indentation instead of deleting a single
        // character. If you want unaligned indentation you may insert a space back
        // with the space key.
        //
        // ### Example 1
        //
        // For example, say the following is a code block and your cursor is `|`:
        //
        // ```
        //     |test
        // ```
        //
        // Pressing backspace will delete two spaces:
        //
        // ```
        //   |test
        // ```
        //
        // Pressing backspace again will delete two more spaces:
        //
        // ```
        // |test
        // ```
        //
        // ### Example 2
        //
        // If your cursor is somewhere inside the indentation it also deletes two
        // spaces, for example:
        //
        // ```
        //   |  test
        // ```
        //
        // Becomes:
        //
        // ```
        //   |  test
        // ```
        //
        // ### Example 3
        //
        // We align deletes to the nearest indentation level. If you cursor is three
        // spaces in we delete only one space instead of two, this:
        //
        // ```
        //    |  test
        // ```
        //
        // Becomes:
        //
        // ```
        //   |  test
        // ```
        //
        // ### Example 4
        //
        // We do not delete spaces after text. This:
        //
        // ```
        //     test  |
        // ```
        //
        // ...after backspace deletes only one space not two:
        //
        // ```
        //     test |
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;

            if ($from.pos !== $to.pos) return false;

            const node = $from.node();
            if (node.type.name !== "codeBlockLine") return false;

            const textLengthUntilSelection = $from.pos - $from.start();
            if (textLengthUntilSelection === 0) return false;

            let childNodeIndex = 0;
            let textIndex = 0;

            while (childNodeIndex < node.childCount && textIndex < textLengthUntilSelection) {
                const childNode = node.child(childNodeIndex);
                if (!childNode.isText) return false;

                const indentationText = childNode.text!.slice(
                    0,
                    textLengthUntilSelection - textIndex,
                );
                if (/[^ ]/.test(indentationText)) return false;

                childNodeIndex += 1;
                textIndex += indentationText.length;
            }

            if (textIndex !== textLengthUntilSelection) return false;

            const newTextLengthUntilSelection =
                (Math.ceil(textLengthUntilSelection / contentCodeBlockIndentationSpaceCount) - 1) *
                contentCodeBlockIndentationSpaceCount;

            dispatch?.(
                state.tr.deleteRange(
                    $from.pos - (textLengthUntilSelection - newTextLengthUntilSelection),
                    $from.pos,
                ),
            );
            return true;
        },

        backspaceCommand,
    );

    keys.set("Backspace", wordBackspaceCommand);
    keys.set("Shift-Backspace", wordBackspaceCommand);
    keys.set("Mod-Backspace", backspaceCommand);

    const deleteCommand = chainCommands(
        // This one is simple. If there is a selection, delete it. If the
        // selection ranges a couple nodes the delete will do the right thing.
        deleteSelection,

        // If delete is pressed in an empty paragraph, remove the paragraph.
        //
        // This feels better than `joinForward` because content immediately jumps
        // to your cursor instead of taking smaller steps.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // |
        // - bar
        // ```
        //
        // Then you press delete:
        //
        // ```
        // - |bar
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();

            const isSelectionInEmptyTextblock =
                $from.pos === $to.pos &&
                $from.parentOffset === 0 &&
                node.isTextblock &&
                node.nodeSize === 2;

            if (!isSelectionInEmptyTextblock) return false;

            if (dispatch) {
                dispatch(state.tr.deleteRange($from.pos - 1, $to.pos + 1));
            }
            return true;
        },

        // If delete is pressed at the end of a textblock, find the next textblock and
        // delete everything in between.
        //
        // This feels better than `joinForward` because content immediately jumps to
        // your cursor instead of taking smaller steps.
        //
        // For example, if the cursor is at `|`:
        //
        // ```
        // foo|
        // - bar
        // ```
        //
        // Then you press delete:
        //
        // ```
        // foo|bar
        // ```
        (state, dispatch) => {
            const {$from, $to} = state.selection;
            const node = $from.node();

            const isSelectionAtEndOfTextblock =
                $from.pos === $to.pos &&
                node.isTextblock &&
                node.nodeSize > 2 &&
                $from.parentOffset === node.nodeSize - 2;

            if (!isSelectionAtEndOfTextblock) return false;

            let nextNodeDepth = $from.depth;
            let nextNode = state.doc.resolve($from.after(nextNodeDepth)).nodeAfter;
            while (!nextNode && nextNodeDepth > 1) {
                nextNodeDepth--;
                nextNode = state.doc.resolve($from.after(nextNodeDepth)).nodeAfter;
            }

            let nextTextblockNode: Node | null = nextNode;
            let depthToNextTextblockNode = 0;
            while (nextTextblockNode && !nextTextblockNode.isTextblock) {
                depthToNextTextblockNode++;
                nextTextblockNode = nextTextblockNode.firstChild;
            }

            if (!nextTextblockNode) return false;

            if (dispatch) {
                dispatch(
                    state.tr.deleteRange(
                        $from.pos,
                        $from.pos + 2 + ($from.depth - nextNodeDepth) + depthToNextTextblockNode,
                    ),
                );
            }
            return true;
        },

        // If the cursor is at the end of a block and the user presses
        // delete then join with the next block.
        joinForward,

        // NOTE: To be honest, I (Caleb) am not sure what this does, but it is in
        // the ProseMirror base keymap so I assume it is important.
        selectNodeForward,
    );

    keys.set("Delete", deleteCommand);
    keys.set("Mod-Delete", deleteCommand);

    keys.set("Mod-]", indentListItemCommand);
    keys.set("Mod-[", dedentListItemCommand);

    keys.set(
        "Tab",
        chainCommands(
            indentListItemCommand,

            // When the user hits tab inside of a document title node, move selection to
            // the next node as if the title and body were two separate inputs as a
            // convenience.
            (state, dispatch) => {
                const {$from, $to} = state.selection;

                // 1. If selection is inside a title.
                const isSelectionInsideTitle =
                    $from.node().type.name === "title" && $to.node().type.name === "title";

                if (!isSelectionInsideTitle) return false;

                // 2. Move selection into the next node.
                const $nextAnchor = state.doc.resolve($from.after() + 1);
                const selection = TextSelection.between($nextAnchor, $nextAnchor);
                if (dispatch) dispatch(state.tr.setSelection(selection));
                return true;
            },

            // When the user hits tab inside of a code block line, we insert 2 spaces
            // of indentation to the current selection.
            (state, dispatch) => {
                const {$from, $to} = state.selection;
                const fromNode = $from.node();
                const toNode = $to.node();
                const fromParentNode = $from.node($from.depth - 1);
                const toParentNode = $to.node($to.depth - 1);
                const isSelectionInsideSameCodeBlock =
                    fromNode.type.name === "codeBlockLine" &&
                    toNode.type.name === "codeBlockLine" &&
                    fromParentNode.type.name === "codeBlock" &&
                    toParentNode.type.name === "codeBlock" &&
                    fromParentNode === toParentNode;

                if (!isSelectionInsideSameCodeBlock) return false;

                if (dispatch) {
                    const transaction = state.tr;
                    const lineStartPos = $from.start($from.depth);

                    // If there is no selection and the cursor is in a empty code block line or
                    // in between content inside of a code block line, we still want to insert
                    // indentation to the line start
                    if ($from.pos === $to.pos) {
                        let minIndentationSpaceCount = 0;

                        let isSelectionInIndentationSpace = true;
                        for (
                            let pos = lineStartPos, childNodeIndex = 0;
                            childNodeIndex < fromNode.childCount;
                            childNodeIndex++
                        ) {
                            const childNode = fromNode.child(childNodeIndex);

                            if (!childNode.isText) {
                                isSelectionInIndentationSpace = false;
                                break;
                            }

                            const text = childNode.text!.slice(0, $from.pos - pos);

                            if (/[^ ]/.test(text)) {
                                isSelectionInIndentationSpace = false;
                                break;
                            }

                            pos += text.length;
                            if (pos >= $from.pos) break;
                        }

                        // If the selection is in the line's initial indentation space, then hitting
                        // tab should go to the maximum indentation of the two adjacent lines.
                        //
                        // Get the indentation of the two adjacent lines and adjust
                        // `minIndentationSpaceCount` so the indentation we add will get us to match
                        // adjacent line indentation.
                        if (isSelectionInIndentationSpace) {
                            const adjacentIndentationSpaceCount =
                                getContentCodeBlockLineAdjacentIndentationSpaceCount($from);

                            minIndentationSpaceCount =
                                adjacentIndentationSpaceCount - ($from.pos - lineStartPos);
                        }

                        const spaces = " ".repeat(
                            Math.max(
                                contentCodeBlockIndentationSpaceCount,
                                minIndentationSpaceCount,
                            ),
                        );

                        transaction.insertText(spaces, lineStartPos);
                        const selection = TextSelection.create(
                            transaction.doc,
                            $from.pos + spaces.length,
                        );
                        transaction.setSelection(selection);
                    } else {
                        const spaces = " ".repeat(contentCodeBlockIndentationSpaceCount);

                        let addedChars = 0;
                        let newSelectionTo = $to.pos;

                        // `nodesBetween` lets us loop through each node and find
                        // the node to add spaces. `addedChars` let's us account for inserted spaces to
                        // ensure the subsequent node inserts are positioned accurately.
                        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
                            if (node.type.name === "codeBlockLine" && !isNodeSpacesOnly(node)) {
                                const insertPos = pos + 1 + addedChars;
                                transaction.insertText(spaces, insertPos);
                                addedChars += spaces.length;
                                newSelectionTo += spaces.length;
                            }
                        });

                        const selection = TextSelection.create(
                            transaction.doc,
                            $from.pos,
                            newSelectionTo,
                        );
                        transaction.setSelection(selection);
                    }

                    dispatch(transaction);
                }
                return true;
            },

            // Don't move focus if we don't apply a shortcut.
            //
            // TODO(calebmer): Kinda clearly this is pretty bad for accessibility.
            // We need to make sure `Esc` unfocuses and allows the keyboard user to
            // resume tab order.
            () => {
                return true;
            },
        ),
    );

    keys.set(
        "Shift-Tab",
        chainCommands(
            dedentListItemCommand,

            // When the user hits shift-tab inside of a node when the previous node is a
            // document title, move selection to the document title as if the title and
            // body were two separate inputs as a convenience.
            (state, dispatch) => {
                const {$from, $to} = state.selection;

                // 1. The selection should be in a single node.
                if ($from.node() !== $to.node()) return false;

                // 2. We should not be the first top-level node.
                const previousTopLevelPos = $from.before(1);
                if (previousTopLevelPos === 0) return false;

                // 3. We do not want shift-tab to work at top level while inside code block
                if ($from.node().type.name === "codeBlockLine") return false;

                // 3. If the last node is a title...
                const $previousTopLevelPos = state.doc.resolve(previousTopLevelPos - 1);
                if ($previousTopLevelPos.node().type.name !== "title") return false;

                // 4. Move selection into the title node.
                const $nextAnchor = state.doc.resolve($previousTopLevelPos.before() + 1);
                const selection = TextSelection.between($nextAnchor, $nextAnchor);
                if (dispatch) dispatch(state.tr.setSelection(selection));
                return true;
            },

            // When the user hits shift-tab inside of a code block, we remove 2 spaces
            // of indentation to the current selection.
            (state, dispatch) => {
                const {from, to, $from, $to} = state.selection;
                const fromNode = $from.node();
                const toNode = $to.node();
                const fromParentNode = $from.node($from.depth - 1);
                const toParentNode = $to.node($to.depth - 1);
                const isSelectionInsideSameCodeBlock =
                    fromNode.type.name === "codeBlockLine" &&
                    toNode.type.name === "codeBlockLine" &&
                    fromParentNode.type.name === "codeBlock" &&
                    toParentNode.type.name === "codeBlock" &&
                    fromParentNode === toParentNode;

                if (!isSelectionInsideSameCodeBlock) return false;

                if (dispatch) {
                    const transaction = state.tr;
                    let removedCharacters = 0;

                    // Loop through the nodes of the selection and determine
                    // start and end positions of the codeBlockLine
                    state.doc.nodesBetween(from, to, (node, pos) => {
                        if (node.type.name !== "codeBlockLine") return;

                        const codeBlockLineIndentationStart = pos + removedCharacters + 1;
                        const codeBlockLineIndentationEnd =
                            codeBlockLineIndentationStart + contentCodeBlockIndentationSpaceCount;

                        const lineText = transaction.doc.textBetween(
                            codeBlockLineIndentationStart,
                            codeBlockLineIndentationEnd,
                        );

                        // If lineText does not start with spaces don't de-dent
                        if (!lineText.startsWith(" ")) {
                            return false;
                        }

                        // Calculate how many spaces to remove from beginning
                        // of codeBlockLine, either remove two space indentation
                        // or one space.
                        const numberOfIndentationToRemove = indentationToRemove(lineText);

                        transaction.delete(
                            codeBlockLineIndentationStart,
                            codeBlockLineIndentationStart + numberOfIndentationToRemove,
                        );

                        // Update removedCharacters, in order to maintain
                        // codeBlockLine start position
                        removedCharacters -= numberOfIndentationToRemove;
                    });
                    dispatch(transaction);
                }
                return true;
            },

            // Don't move focus if we don't apply a shortcut.
            //
            // TODO(calebmer): Kinda clearly this is pretty bad for accessibility.
            // We need to make sure `Esc` unfocuses and allows the keyboard user to
            // resume tab order.
            () => {
                return true;
            },
        ),
    );

    keys.set("ArrowDown", (state, dispatch) => {
        const {selection, schema} = state;
        const {$from} = selection;
        const isSelectionAtEndOfDoc = selection.eq(Selection.atEnd(state.doc));

        // 1. Check if the selection is the last object in the entire doc
        if (!isSelectionAtEndOfDoc) {
            return false;
        }

        const parentNode = $from.node($from.depth - 1);
        const currentNode = $from.node();

        // 2. Check if the selection is a codeBlockLine and within codeBlock
        if (currentNode.type.name === "codeBlockLine" && parentNode.type.name === "codeBlock") {
            const paragraphNode = schema.nodes.paragraph;
            if (!paragraphNode) {
                return false;
            }

            if (dispatch) {
                const insertPosition = state.doc.content.size;
                const transaction = state.tr;
                transaction.insert(insertPosition, paragraphNode.create());
                transaction.setSelection(TextSelection.create(transaction.doc, insertPosition + 1));
                dispatch(transaction);
            }

            return true;
        }

        return false;
    });

    // In a code block, if you hit the line start shortcut, it should go to the
    // start of the line excluding indentation spaces. For example if this is a
    // code block and your cursor is `|`:
    //
    // ```
    //     test|
    // ```
    //
    // Hitting Command-Left should go to:
    //
    // ```
    //     |test
    // ```
    //
    // Hitting Command-Left again should now go to the start of the line:
    //
    // ```
    // |    test
    // ```
    //
    // Then hitting Command-Left a third time should go back to the start of the
    // code line (this alternating pattern is what VS Code does, it's convenient if
    // you accidentally hit Command-Left a second time).
    //
    // ```
    //     |test
    // ```
    keys.set("Mod-ArrowLeft", (state, dispatch) => {
        const {$from} = state.selection;

        const fromNode = $from.node();
        if (fromNode.type.name !== "codeBlockLine") return false;

        const fromNodeStartPos = $from.start();
        const fromRelativePos = $from.pos - fromNodeStartPos;

        let indentationTextLength = 0;

        for (let childNodeIndex = 0; childNodeIndex < fromNode.childCount; childNodeIndex++) {
            const childNode = fromNode.child(childNodeIndex);
            if (!childNode.isText) break;

            for (let i = 0; i < childNode.text!.length; i++) {
                if (childNode.text![i] !== " ") {
                    break;
                }
                indentationTextLength++;
                if (fromRelativePos !== 0 && fromRelativePos <= indentationTextLength) {
                    dispatch?.(
                        state.tr.setSelection(
                            new TextSelection(state.doc.resolve(fromNodeStartPos)),
                        ),
                    );
                    return true;
                }
            }
        }

        dispatch?.(
            state.tr.setSelection(
                new TextSelection(state.doc.resolve(fromNodeStartPos + indentationTextLength)),
            ),
        );
        return true;
    });

    // In a code block, if you hit the line start shortcut, it should go to the
    // start of the line excluding indentation spaces. If you also hold shift then
    // it should select the text in between your existing cursor and the new
    // location. For example if this is a code block and your cursor is `|`:
    //
    // ```
    //     test|
    // ```
    //
    // Hitting Command-Shift-Left should go to:
    //
    // ```
    //     |test|
    // ```
    //
    // Hitting Command-Shift-Left again should now go to the start of the line:
    //
    // ```
    // |    test|
    // ```
    //
    // Then hitting Command-Shift-Left a third time should go back to the start of
    // the code line (this alternating pattern is what VS Code does, it's
    // convenient if you accidentally hit Command-Shift-Left a second time).
    //
    // ```
    //     |test|
    // ```
    keys.set("Mod-Shift-ArrowLeft", (state, dispatch) => {
        const {$from, $to} = state.selection;

        const fromNode = $from.node();
        if (fromNode.type.name !== "codeBlockLine") return false;

        const fromNodeStartPos = $from.start();
        const fromRelativePos = $from.pos - fromNodeStartPos;

        let indentationTextLength = 0;
        if (fromRelativePos !== 0 && fromRelativePos <= indentationTextLength) return false;

        for (let childNodeIndex = 0; childNodeIndex < fromNode.childCount; childNodeIndex++) {
            const childNode = fromNode.child(childNodeIndex);

            for (let i = 0; i < childNode.text!.length; i++) {
                if (childNode.text![i] !== " ") {
                    break;
                }
                indentationTextLength++;
                if (fromRelativePos !== 0 && fromRelativePos <= indentationTextLength) {
                    dispatch?.(
                        state.tr.setSelection(
                            new TextSelection($to, state.doc.resolve(fromNodeStartPos)),
                        ),
                    );
                    return true;
                }
            }
        }

        dispatch?.(
            state.tr.setSelection(
                new TextSelection($to, state.doc.resolve(fromNodeStartPos + indentationTextLength)),
            ),
        );
        return true;
    });

    keys.set("Mod-a", selectAll);

    // Toggle inline formats
    keys.set("Mod-b", createToggleMarkCommand(schema.mark("bold")));
    keys.set("Mod-i", createToggleMarkCommand(schema.mark("italic")));
    keys.set("Mod-shift-x", createToggleMarkCommand(schema.mark("strike")));
    keys.set("Mod-shift-k", createToggleMarkCommand(schema.mark("code")));

    // Highlight overlay
    if (schema.marks.highlight) {
        keys.set("Mod-shift-h", (state, dispatch) => {
            // Only open highlight color selector if we're selecting some text.
            if (state.selection.from === state.selection.to) {
                return false;
            }

            let isHighlightSupported = false;
            state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
                if (!node.inlineContent) return;
                isHighlightSupported ||= node.type.allowsMarkType(schema.marks.highlight!);
            });

            if (!isHighlightSupported) return false;

            dispatch?.(state.tr.setMeta(openKeyboardHighlightFloaterMetaKey, true));
            return true;
        });
    }

    // Link overlay
    keys.set("Mod-k", (state, dispatch) => {
        // Only open highlight color selector if we're selecting some text.
        if (state.selection.from === state.selection.to) {
            return false;
        }

        let isLinkSupported = false;
        state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
            if (!node.inlineContent) return;
            isLinkSupported ||= node.type.allowsMarkType(schema.marks.link);
        });

        if (!isLinkSupported) return false;

        dispatch?.(state.tr.setMeta(openKeyboardLinkFloaterMetaKey, true));
        return true;
    });

    // Comments
    if (schema.marks.comment) {
        keys.set("Mod-shift-c", (state, dispatch) => {
            // Only open comment input if we're selecting some text.
            if (state.selection.from === state.selection.to) {
                return false;
            }

            let isCommentSupported = false;
            state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
                if (!node.inlineContent) return;
                isCommentSupported ||=
                    !!schema.marks.comment && node.type.allowsMarkType(schema.marks.comment);
            });

            if (!isCommentSupported) return false;

            dispatch?.(state.tr.setMeta(openCommentInputFloaterMetaKey, true));
            return true;
        });
    }

    // Based on the [ProseMirror base MacOS keybinding][1] map and the [MacOS
    // keyboard shortcut][2] documentation.
    //
    // We're ok not adding these keybindings on the server. It doesn't influence
    // server rendered HTML.
    //
    // [1]: https://github.com/ProseMirror/prosemirror-commands/blob/3126d5c625953ba590c5d3a0db7f1009f46f1571/src/commands.js#L588
    // [2]: https://support.apple.com/en-us/HT201236
    if (typeof window !== "undefined" && getClientInfoWithoutListening().isAppleDevice) {
        keys.set("Alt-Backspace", wordBackspaceCommand);
        keys.set("Alt-Delete", deleteCommand);
        keys.set("Ctrl-h", wordBackspaceCommand);
        keys.set("Ctrl-d", deleteCommand);
    }

    {
        const sharedKeys = new Map<string, Command>();
        addSharedContentEditorKeymapCommands(sharedKeys);

        for (const [key, sharedCommand] of sharedKeys) {
            const command = keys.get(key);
            if (command === undefined) {
                keys.set(key, sharedCommand);
            } else {
                keys.set(key, chainCommands(sharedCommand, command));
            }
        }
    }

    const handleKeyDown = keydownHandler(Object.fromEntries(keys));

    return new Plugin({
        props: {
            // Our codebase convention is to call `event.preventDefault()` and
            // `event.stopPropagation()` whenever a `keydown` event is handled. ProseMirror
            // will only call `event.preventDefault()` when a keydown handler returns true.
            // So construct a plugin where we also call `event.stopPropagation()`.
            //
            // We call `event.stopPropagation()` so global `keydown` handlers don't see
            // events we've already handled. Particularly important for undo where we have
            // a global undo handler and a local undo handler. If our local undo handles
            // the keyboard shortcut we don't want to run our global handler.
            handleKeyDown: (view, event) => {
                const result = handleKeyDown(view, event);
                if (result) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return result;
            },
        },
    });
}
