import {
    chainCommands,
    deleteSelection,
    joinBackward,
    joinForward,
    liftEmptyBlock,
    newlineInCode,
    selectAll,
    selectNodeBackward,
    selectNodeForward,
    splitBlock,
    toggleMark,
} from "prosemirror-commands";
import {redo, undo} from "prosemirror-history";
import {undoInputRule} from "prosemirror-inputrules";
import {keymap} from "prosemirror-keymap";
import {Node} from "prosemirror-model";
import {EditorState, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {isMac} from "~/client/helpers/platform/is-mac";
import {ContentSchema, maxListItemIndentation} from "~/shared/content/content-schema";

type Command = (
    state: EditorState,
    transact?: (tr: Transaction) => void,
    view?: EditorView,
) => boolean;

export const openHighlightToolbarMetaKey = "openHighlightToolbar";
export const openLinkToolbarMetaKey = "openLinkToolbar";

export function buildKeymapPlugin() {
    const keys = new Map<string, Command>();

    // History
    keys.set("Mod-z", chainCommands(undoInputRule, undo));
    keys.set("Mod-shift-z", redo);
    keys.set("Mod-y", redo); // https://en.wikipedia.org/wiki/Control-Y

    const enterCommand: Command = chainCommands(
        // When in code enter creates a new line instead of creating a
        // paragraph block.
        newlineInCode,

        // If "Enter" is pressed in an empty paragraph textblock which is wrapped
        // in another block then remove the wrapping.
        //
        // For example, if "Enter" is pressed in an empty quote we will convert
        // it to a paragraph.
        liftEmptyBlock,

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
                node.type === ContentSchema.nodes.paragraph
            ) {
                return false;
            }

            // 2. Convert the textblock to a paragraph.
            if (dispatch) {
                dispatch(state.tr.setBlockType($from.pos, $to.pos, ContentSchema.nodes.paragraph));
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

        // Create a new node by splitting the current block at the cursor. If the
        // cursor is at the end of the block this will simply create a new block.
        // If the cursor is in the middle of the block it will split the block
        // in two.
        splitBlock,
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
            dispatch(
                state.tr.replaceSelectionWith(ContentSchema.nodes.break.create()).scrollIntoView(),
            );
        }
        return true;
    };

    keys.set("Alt-Enter", altEnterCommand);
    keys.set("Ctrl-Enter", altEnterCommand);

    const backspaceCommand: Command = chainCommands(
        // This one is simple. If there is a selection, delete it. If the
        // selection ranges a couple nodes the delete will do the right thing.
        deleteSelection,

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
                node.type !== ContentSchema.nodes.paragraph &&
                $from.pos === $to.pos &&
                $from.parentOffset === 0;

            if (!isSelectionAtFirstOffsetOfTextblock) return false;

            // 2. Convert the textblock to a paragraph.
            if (dispatch) {
                dispatch(state.tr.setBlockType($from.pos, $to.pos, ContentSchema.nodes.paragraph));
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
                node.type === ContentSchema.nodes.paragraph &&
                (parentNode.type === ContentSchema.nodes.quoteBlock ||
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
            if (dispatch) {
                dispatch(state.tr.lift($from.blockRange()!, $from.depth - 2));
            }
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
                $from.node().type === ContentSchema.nodes.paragraph;

            if (!isSelectionAtFirstOffsetOfParagraph) return false;

            // 2. Paragraph should be after a list.
            const lastNode = state.doc.resolve($from.before()).nodeBefore;
            const isLastNodeListItemOrQuoteBlock =
                lastNode &&
                (lastNode.type.groups.includes("listItem") ||
                    lastNode.type === ContentSchema.nodes.quoteBlock);

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

        // If the cursor is at the beginning of a block and the user presses
        // backspace then join with the prior block.
        joinBackward,

        // NOTE: To be honest, I (Caleb) am not sure what this does, but it is in
        // the ProseMirror base keymap so I assume it is important.
        selectNodeBackward,
    );

    keys.set("Backspace", backspaceCommand);
    keys.set("Mod-Backspace", backspaceCommand);
    keys.set("Shift-Backspace", backspaceCommand);

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
        // - foo|bar
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
            while (!nextNode && nextNodeDepth >= 0) {
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

    // Indent all list items in a selection. Only indents if all the selected
    // list items can be successfully indented.
    //
    // While it is possible to create valid documents with what this command
    // might consider "invalid" indentation we force an indent to be valid
    // when pressing tab. This helps users stay within the pit of success.
    //
    // For example, if the cursor is at `|`:
    //
    // ```
    // - test
    // - test|
    // ```
    //
    // Then you press tab:
    //
    // ```
    // - test
    //   - test|
    // ```
    const indentCommand: Command = (state, dispatch) => {
        const {$from, $to} = state.selection;

        let failed = false;
        let capture = false;
        const transaction = state.tr;
        const indented = new Set();

        // 1. Iterate through all the nodes in the selection.
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            // 2. All of the top-level nodes in the selection should be list
            // items.
            if (!node.type.groups.includes("listItem")) {
                failed = true;
                return false;
            }

            // If there is at least one list item in the selection then we still
            // want to capture this keybinding. We conservatively assume the user
            // wants to indent their text instead of another contextual use of
            // the keybinding (like focus navigation).
            capture = true;

            // If we already failed we can stop processing.
            if (failed) return false;

            // 3. All nodes preceding the target list items should also be
            // list items.
            const lastNode = pos - 1 >= 0 ? state.doc.resolve(pos - 1).node() : null;
            if (!lastNode || !lastNode.type.groups.includes("listItem")) {
                failed = true;
                return false;
            }

            // 4. Indent each list item node by one, but don't indent past our max
            // indentation level.
            const newIndent = Math.min(node.attrs.indent + 1, maxListItemIndentation);

            const lastNodeIndent = lastNode.attrs.indent + (indented.has(node) ? 1 : 0);

            // 5. Our node's indentation must be less than or equal to the last
            // node's indentation. This way we're either "attached" to the node
            // or assume that the last node is correctly attached to a
            // parent itself.
            if (newIndent > lastNodeIndent + 1) {
                failed = true;
                return false;
            }

            // 6. Actually update the node's indentation attribute.
            transaction.setNodeMarkup(pos, node.type, {
                ...node.attrs,
                indent: newIndent,
            });

            indented.add(node);
            return false;
        });

        // 7. Only perform the indentation if all nodes in the selection can
        // be indented.
        if (failed) return capture;
        if (dispatch) dispatch(transaction.scrollIntoView());
        return true;
    };

    // Dedent all list items in a selection. Only dedents if all the selected
    // list items can be successfully dedented.
    //
    // For example, if the cursor is at `|`:
    //
    // ```
    // - test
    //   - test|
    // ```
    //
    // Then you press shift-tab:
    //
    // ```
    // - test
    // - test|
    // ```
    const dedentCommand: Command = (state, dispatch) => {
        const {$from, $to} = state.selection;

        let failed = false;
        let capture = false;
        const transaction = state.tr;

        // 1. Iterate through all the nodes in the selection.
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            // 2. All of the top-level nodes in the selection should be list
            // items.
            if (!node.type.groups.includes("listItem")) {
                failed = true;
                return false;
            }

            // If there is at least one list item in the selection then we still
            // want to capture this keybinding. We conservatively assume the user
            // wants to indent their text instead of another contextual use of
            // the keybinding (like focus navigation).
            capture = true;

            // If we already failed we can stop processing.
            if (failed) return false;

            // 3. Don't dedent if this list item already doesn't have
            // any indentation.
            if (node.attrs.indent === 0) {
                failed = true;
                return false;
            }

            // 4. Dedent each list item node by one.
            const newIndent = node.attrs.indent - 1;

            // 5. If we have a list item after this node then our node's
            // indentation must be less than or equal to the next node's
            // indentation. This way we don't accidentally detach our node.
            const nextNode =
                pos + node.content.size + 3 <= state.doc.content.size
                    ? state.doc.resolve(pos + node.content.size + 3).node()
                    : null;
            if (nextNode?.type.groups.includes("listItem")) {
                const nextNodeIndent = nextNode.attrs.indent;

                if (nextNodeIndent > newIndent + 1) {
                    failed = true;
                    return false;
                }
            }

            // 6. Actually update the node's indentation attribute.
            transaction.setNodeMarkup(pos, node.type, {
                ...node.attrs,
                indent: newIndent,
            });

            return false;
        });

        // 7. Only perform the indentation if all nodes in the selection can
        // be dedented.
        if (failed) return capture;
        if (dispatch) dispatch(transaction.scrollIntoView());
        return true;
    };

    keys.set("Mod-]", indentCommand);
    keys.set("Mod-[", dedentCommand);

    keys.set(
        "Tab",
        chainCommands(
            indentCommand,

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
            dedentCommand,

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

    keys.set("Mod-a", selectAll);

    // Toggle inline formats
    keys.set("Mod-b", toggleMark(ContentSchema.marks.bold));
    keys.set("Mod-i", toggleMark(ContentSchema.marks.italic));
    keys.set("Mod-shift-x", toggleMark(ContentSchema.marks.strike));
    keys.set("Mod-shift-k", toggleMark(ContentSchema.marks.code));

    // Highlight overlay
    keys.set("Mod-shift-h", (state, dispatch) => {
        // Only open highlight color selector if we're selecting some text.
        if (state.selection.from === state.selection.to) {
            return false;
        }

        dispatch?.(state.tr.setMeta(openHighlightToolbarMetaKey, true));
        return true;
    });

    // Link overlay
    keys.set("Mod-k", (state, dispatch) => {
        // Only open highlight color selector if we're selecting some text.
        if (state.selection.from === state.selection.to) {
            return false;
        }

        dispatch?.(state.tr.setMeta(openLinkToolbarMetaKey, true));
        return true;
    });

    // Based on the [ProseMirror base MacOS keybinding][1] map and the [MacOS
    // keyboard shortcut][2] documentation.
    //
    // [1]: https://github.com/ProseMirror/prosemirror-commands/blob/3126d5c625953ba590c5d3a0db7f1009f46f1571/src/commands.js#L588
    // [2]: https://support.apple.com/en-us/HT201236
    if (isMac) {
        keys.set("Alt-Backspace", backspaceCommand);
        keys.set("Alt-Delete", deleteCommand);
        keys.set("Ctrl-h", backspaceCommand);
        keys.set("Ctrl-d", deleteCommand);
    }

    // TODO(calebmer): Cmd+K to add a link to text. We need to build the link
    // dialog for this.

    // TODO(calebmer): Cmd+Shift+H to add a highlight to text. We need to build
    // the highlight selection dialog for this.

    return keymap(Object.fromEntries(keys));
}
