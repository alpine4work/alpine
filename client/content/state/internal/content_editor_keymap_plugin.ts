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
import {Node, ResolvedPos, Slice} from "prosemirror-model";
import {
    EditorState,
    NodeSelection,
    Plugin,
    Selection,
    TextSelection,
    Transaction,
} from "prosemirror-state";
import {liftTarget} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {
    openContentEditorCommentInputFloaterMetaKey,
    openContentEditorKeyboardHighlightFloaterMetaKey,
    openContentEditorKeyboardLinkFloaterMetaKey,
} from "~/client/content/state/content_editor_meta_keys.js";
import {contentEditorQuickUndoCommand} from "~/client/content/state/content_editor_state.js";
import {createToggleMarkCommand} from "~/client/content/state/create_toggle_mark_command.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/content/state/indent_and_dedent_list_item_commands.js";
import {getContentCodeBlockLineAdjacentIndentationSpaceCount} from "~/client/content/state/internal/get_content_code_block_line_adjacent_indentation_space_count.js";
import {splitBlockWithCodeBlockLineLeadingIndentation} from "~/client/content/state/internal/split_block_with_code_block_line_leading_indentation.js";
import {addSharedContentEditorKeymapCommands} from "~/client/content/state/shared/add_shared_content_editor_keymap_commands.js";
import {isSelectionInContentTable} from "~/client/content/state/table/content_table_client_util.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentProsemirrorSchema,
    contentCodeBlockIndentationSpaceCount,
} from "~/shared/content/content_schema.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";

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
            // the `liftEmptyBlock` behavior to break the `codeBlock`, instead we
            // want to use `splitBlock`. `LiftEmptyBlock` behavior splits the
            // `codeBlock` into two separate codeBlocks.
            //
            // For example (behavior we do NOT want): if the cursor is at `|`:
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

            // If we are inside an empty paragraph in a `quoteBlock` then we always want to
            // use `lift()` not `split()`. `lift()` will make sure the empty paragraph is
            // always lifted to the top level. By default if our cursor `|` is here:
            //
            // ```
            // > foo
            // > |
            // > bar
            // ```
            //
            // Then `liftEmptyBlock()` gives us this:
            //
            // ```
            // > foo
            //
            // > |
            // > bar
            // ```
            //
            // Note that there's not an empty paragraph between the two quote blocks. It's
            // two adjacent quote blocks. Instead we want this:
            //
            // ```
            // > foo
            //
            // |
            //
            // > bar
            // ```
            //
            // Under some conditions, the [`liftEmptyBlock` command will use the `split()`
            // transform instead of the `lift()` transform][1]. Effectively we're making
            // sure we always call the `lift()` branch of `liftEmptyBlock` in this case.
            //
            // [1]: https://github.com/ProseMirror/prosemirror-commands/blob/20c7d42ab8b5d8642fb9efc6261b7541c9dc23c2/src/commands.ts#L342-L348
            if (
                $from.pos === $to.pos &&
                node.type.name === "paragraph" &&
                parentNode.type.name === "quoteBlock" &&
                node.childCount === 0
            ) {
                const range = $from.blockRange();
                const target = range && liftTarget(range);
                if (range === null || target === null) return false;
                if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
                return true;
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

        // If the user presses enter while a file is selected we create a new paragraph
        // underneath the file so the user can continue typing. This is different from
        // the usual behavior of enter deleting the selection and replacing it with a
        // paragraph. Files are typically added with a lot of intention from the user
        // so protect them from accidentally deleting their file by typing over it.
        //
        // We have similar logic in `handleTextInput` below when we create our keymap
        // plugin.
        (state, dispatch) => {
            // 1. If we've selected a file.
            if (!(state.selection instanceof NodeSelection)) return false;
            if (state.selection.node.type.name !== "file") return false;
            if (!state.selection.$anchor.parent.type.groups.includes("fileRowLike")) {
                return false;
            }

            if (dispatch) {
                const transaction = state.tr.insert(
                    state.selection.$anchor.after(),
                    schema.node("paragraph"),
                );

                dispatch(
                    transaction
                        .setSelection(
                            TextSelection.near(
                                transaction.doc.resolve(state.selection.$anchor.after() + 1),
                            ),
                        )
                        .scrollIntoView(),
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
                // 1    test|
                // ```
                //
                // Hitting enter should give us:
                //
                // ```
                // 1    test
                // 2    |
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

    const altEnterCommand: Command = chainCommands(
        // If the user presses alt+enter while a file is selected we create a new
        // paragraph above the file so the user can continue typing. This is different
        // from the usual behavior of enter deleting the selection and replacing it
        // with a paragraph. Files are typically added with a lot of intention from the user
        // so protect them from accidentally deleting their file by typing over it.
        (state, dispatch) => {
            // 1. If we've selected a file.
            if (!(state.selection instanceof NodeSelection)) return false;
            if (state.selection.node.type.name !== "file") return false;
            if (!state.selection.$anchor.parent.type.groups.includes("fileRowLike")) {
                return false;
            }

            if (dispatch) {
                const transaction = state.tr.insert(
                    state.selection.$anchor.before(),
                    schema.node("paragraph"),
                );

                dispatch(
                    transaction
                        .setSelection(
                            TextSelection.near(
                                transaction.doc.resolve(state.selection.$anchor.before() + 1),
                            ),
                        )
                        .scrollIntoView(),
                );
            }

            return true;
        },

        // Pressing alt+enter creates a hard break (aka a new line). You can use
        // alt+enter to create a list item with multiple lines, for instance.
        (state, dispatch) => {
            const {$from} = state.selection;
            const fromNode = $from.node();
            const isSelectionInCodeBlockLine = fromNode.type.name === "codeBlockLine";

            if (!isSelectionInCodeBlockLine) {
                dispatch?.(
                    state.tr.replaceSelectionWith(schema.nodes.break.create()).scrollIntoView(),
                );
                return true;
            } else {
                // In a code block, alt+enter always creates a new code block line. Unlike
                // `Enter` which will stop creating newlines at the end of a code block and
                // will convert to a paragraph.
                return splitBlockWithCodeBlockLineLeadingIndentation(state, dispatch);
            }
        },
    );

    keys.set("Alt-Enter", altEnterCommand);
    keys.set("Ctrl-Enter", altEnterCommand);

    const setSelectionToPreviousFileIfExists = (transaction: Transaction) => {
        for (let depth = transaction.selection.$from.depth; depth >= 0; depth--) {
            const node = transaction.selection.$from.node(depth);
            const index = transaction.selection.$from.index(depth);
            if (!(index - 1 >= 0)) continue;

            const siblingNode = node.child(index - 1);
            if (!siblingNode.type.groups.includes("fileRowLike")) continue;

            transaction.setSelection(
                new NodeSelection(
                    transaction.doc.resolve(transaction.selection.$from.before(depth + 1) - 2),
                ),
            );
            break;
        }

        return transaction;
    };

    const setSelectionToNextFileIfExists = (transaction: Transaction) => {
        for (let depth = transaction.selection.$from.depth; depth >= 0; depth--) {
            const node = transaction.selection.$from.node(depth);
            const index = transaction.selection.$from.index(depth);
            if (!(index + 1 < node.childCount)) continue;

            const siblingNode = node.child(index + 1);
            if (!siblingNode.type.groups.includes("fileRowLike")) continue;

            transaction.setSelection(
                new NodeSelection(
                    transaction.doc.resolve(transaction.selection.$from.after(depth + 1) + 1),
                ),
            );
            break;
        }

        return transaction;
    };

    const actuallyDeleteSelection =
        (isBackspace: boolean): Command =>
        (state, dispatch, view) => {
            if (dispatch) {
                const originalDispatch = dispatch;

                dispatch = transaction => {
                    // If we had a `file` `NodeSelection` when backspace was pressed and we don't
                    // have a `file` `NodeSelection` anymore because we deleted the last file in a
                    // gallery so the next position is in a paragraph or whatever's next then we
                    // want to search backwards for the last file in the gallery and put our
                    // selection there.
                    //
                    // The user expects their selection to stay in the gallery while issuing
                    // keyboard commands. So it's weird if hitting delete causes their selection
                    // to leave the gallery.
                    if (
                        state.selection instanceof NodeSelection &&
                        state.selection.node.type.name === "file" &&
                        state.selection.$anchor.parent.type.groups.includes("fileRowLike")
                    ) {
                        if (
                            transaction.selection instanceof NodeSelection &&
                            transaction.selection.node.type.name === "file" &&
                            transaction.selection.$anchor.parent.type.groups.includes("fileRowLike")
                        ) {
                            // Our new selection is already a file selection. Don't do anything else.
                        } else {
                            setSelectionToPreviousFileIfExists(transaction);
                        }
                    }
                    // If backspace was pressed on a `NodeSelection`, we want to make sure the
                    // cursor is placed before the node not after the node.
                    else if (isBackspace && state.selection instanceof NodeSelection) {
                        transaction.setSelection(
                            Selection.near(transaction.doc.resolve(state.selection.anchor), -1),
                        );
                    }

                    originalDispatch(transaction);
                };
            }

            return deleteSelection(state, dispatch, view);
        };

    const backspaceCommand: Command = chainCommands(
        // This one is simple. If there is a selection, delete it. If the
        // selection ranges a couple nodes the delete will do the right thing.
        actuallyDeleteSelection(true),

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
        //
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

                transaction.setSelection(
                    Selection.near(transaction.doc.resolve($from.before($from.depth - 1)), -1),
                );

                dispatch(transaction);
            }
            return true;
        },

        // If the selection is at the beginning of a text block and there's a `fileRow`
        // right before the selection then we want backspace to select the previous
        // file but not delete it! We select the previous file as a way to confirm with
        // the user "are you sure you want to delete this?" Files are added with a lot
        // of intention from the user so we want to help protect the user from
        // accidentally deleting their attached files.
        (state, dispatch) => {
            const {$from, $to} = state.selection;

            // 1. Cursor should be at the beginning of a textblock.
            const isSelectionAtFirstOffsetOfTextblock =
                $from.pos === $to.pos && $from.parentOffset === 0 && $from.parent.isTextblock;

            if (!isSelectionAtFirstOffsetOfTextblock) return false;

            let $previousFile: ResolvedPos | null = null;

            for (let depth = state.selection.$from.depth; depth >= 0; depth--) {
                const node = state.selection.$from.node(depth);
                const index = state.selection.$from.index(depth);
                if (!(index - 1 >= 0)) continue;

                const siblingNode = node.child(index - 1);
                if (!siblingNode.type.groups.includes("fileRowLike")) continue;

                $previousFile = state.doc.resolve(state.selection.$from.before(depth + 1) - 2);
                break;
            }

            // 2. If there's a file before our selection in the textblock.
            if (!$previousFile) return false;

            assert($previousFile.parent.type.groups.includes("fileRowLike"));
            assert($previousFile.nodeAfter?.type.name === "file");

            // If the textblock is empty then hitting backspace should delete the
            // textblock select the previous file.
            if ($from.parent.nodeSize <= 2) {
                dispatch?.(
                    setSelectionToPreviousFileIfExists(
                        state.tr.replaceRange($from.before(), $from.after(), Slice.empty),
                    ).scrollIntoView(),
                );
                return true;
            }

            dispatch?.(setSelectionToPreviousFileIfExists(state.tr).scrollIntoView());
            return true;
        },

        // If the cursor is at the beginning of a block and the user presses
        // backspace then join with the prior block.
        joinBackward,

        // In a document with only a title and a single paragraph, if you hit backspace
        // at the start of the paragraph the paragraph should be joined with the title
        // above. However, `joinBackward()` can't do this since it would remove the one
        // and only paragraph making the document invalid. So detect this case and
        // pretend like there's another empty paragraph at the end of the document.
        // Then `joinBackward()` can work and the empty paragraph will become the
        // document's one paragraph.
        //
        // For example, if the cursor is at `|` the title is `<h1>` and a paragraph is
        // in `<p>`:
        //
        // ```
        // <h1>foo</h1>
        // <p>|bar</p>
        // ```
        //
        // Then the result should be:
        //
        // ```
        // <h1>foo|bar</h1>
        // <p></p>
        // ```
        (state, dispatch) => {
            // 1. Must be in a document with a title
            if (!state.schema.nodes.title) return false;

            // 2. Handling the edge case where we have a title and a paragraph
            if (state.doc.childCount !== 2) return false;

            const {$from, $to} = state.selection;

            // 3. Cursor should be at the beginning of a textblock.
            const isSelectionAtFirstOffsetOfTextblock =
                $from.pos === $to.pos && $from.parentOffset === 0 && $from.parent.isTextblock;

            if (!isSelectionAtFirstOffsetOfTextblock) return false;

            // 4. Cursor should be in the second node
            if ($from.index(0) !== 1) return false;

            const transaction = state.tr.insert(
                state.doc.nodeSize - 2,
                state.schema.nodes.paragraph!.create(),
            );

            // 5. Retry `joinBackward()` but with an empty paragraph inserted at the end of
            //    the document
            return joinBackward(
                state.apply(transaction),
                // Copy the transaction this function was called with (`actualTransaction`)
                // into `transaction` which the new paragraph insertion.
                dispatch
                    ? actualTransaction => {
                          for (const step of actualTransaction.steps) {
                              transaction.step(step);
                          }

                          if (actualTransaction.selectionSet) {
                              transaction.setSelection(actualTransaction.selection);
                          }

                          if (actualTransaction.storedMarksSet) {
                              transaction.setStoredMarks(actualTransaction.storedMarks);
                          }

                          if (actualTransaction.scrolledIntoView) {
                              transaction.scrollIntoView();
                          }

                          dispatch(transaction);
                      }
                    : undefined,
            );
        },

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
            if (mention.type !== "Account" || mention.isShort) return false;

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
        actuallyDeleteSelection(false),

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

        // If the selection is at the end of a text block and there's a `fileRow`
        // right after the selection then we want delete to select the next
        // file but not delete it! We select the next file as a way to confirm with
        // the user "are you sure you want to delete this?" Files are added with a lot
        // of intention from the user so we want to help protect the user from
        // accidentally deleting their attached files.
        (state, dispatch) => {
            const {$from, $to} = state.selection;

            // 1. Cursor should be at the end of a textblock.
            const isSelectionAtLastOffsetOfTextblock =
                $from.pos === $to.pos &&
                $from.parent.isTextblock &&
                $from.parent.nodeSize > 2 &&
                $from.parentOffset === $from.parent.nodeSize - 2;

            if (!isSelectionAtLastOffsetOfTextblock) return false;

            let $nextFile: ResolvedPos | null = null;

            for (let depth = state.selection.$from.depth; depth >= 0; depth--) {
                const node = state.selection.$from.node(depth);
                const index = state.selection.$from.index(depth);
                if (!(index + 1 < node.childCount)) continue;

                const siblingNode = node.child(index + 1);
                if (!siblingNode.type.groups.includes("fileRowLike")) continue;

                $nextFile = state.doc.resolve(state.selection.$from.after(depth + 1) + 1);
                break;
            }

            // 2. If there's a file after our selection in the textblock.
            if (!$nextFile) return false;

            assert($nextFile.parent.type.groups.includes("fileRowLike"));
            assert($nextFile.nodeAfter?.type.name === "file");

            // If the textblock is empty then hitting backspace should delete the
            // textblock. Not delete the file.
            if ($from.parent.nodeSize <= 2) {
                dispatch?.(
                    setSelectionToNextFileIfExists(
                        state.tr.replaceRange($from.before(), $from.after(), Slice.empty),
                    ).scrollIntoView(),
                );
                return true;
            }

            dispatch?.(setSelectionToNextFileIfExists(state.tr).scrollIntoView());
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

    keys.set(
        "ArrowDown",
        chainCommands(
            // To escape certain nodes pressing down at the end of a document should create
            // a new empty paragraph and move the cursor there. That way the user doesn't
            // get stuck editing the element.
            //
            // For example, consider a `divider` element. If a `divider` is the last
            // element in the document how would you write some text beneath it? Without
            // this shortcut there's no keyboard accessible way to do so. With this
            // shortcut if you hit the down arrow we create an empty paragraph where you
            // can continue typing.
            (state, dispatch) => {
                const {selection, schema} = state;
                const {$from} = selection;
                const isSelectionAtEndOfDoc = selection.eq(Selection.atEnd(state.doc));

                // 1. Check if the selection is the last object in the entire doc
                if (!isSelectionAtEndOfDoc) {
                    return false;
                }

                const parentNode = $from.node($from.depth - 1);
                const currentNode = $from.node();

                // 2. Check if the selection is a `codeBlockLine` within `codeBlock`, a
                //    `divider`, or a `file`
                if (
                    (currentNode.type.name === "codeBlockLine" &&
                        parentNode.type.name === "codeBlock") ||
                    (selection instanceof NodeSelection &&
                        (selection.node.type.name === "divider" ||
                            selection.node.type.name === "file")) ||
                    isSelectionInContentTable(selection)
                ) {
                    const paragraphNode = schema.nodes.paragraph;
                    if (!paragraphNode) {
                        return false;
                    }

                    if (dispatch) {
                        // `state.doc.content.size` is the last position in the document.
                        const insertPosition = state.doc.content.size;
                        const transaction = state.tr;
                        transaction.insert(insertPosition, paragraphNode.create());
                        transaction.setSelection(
                            TextSelection.create(transaction.doc, insertPosition + 1),
                        );
                        dispatch(transaction);
                    }

                    return true;
                }

                return false;
            },
        ),
    );

    keys.set(
        "ArrowUp",
        chainCommands(
            // To escape certain nodes pressing up at the start of a document should create
            // a new empty paragraph and move the cursor there. That way the user doesn't
            // get stuck editing the element.
            //
            // For example, consider a `fileRow` element in a post. If a `fileRow` is the
            // first element in the post how would you write some text above it? Without
            // this shortcut there's no keyboard accessible way to do so. With this
            // shortcut if you hit the up arrow we create an empty paragraph where you
            // can continue typing.
            (state, dispatch) => {
                const {selection, schema} = state;
                const {$from} = selection;
                const isSelectionAtStartOfDoc = selection.eq(Selection.atStart(state.doc));

                // 1. Check if the selection is the last object in the entire doc
                if (!isSelectionAtStartOfDoc) {
                    return false;
                }

                const parentNode = $from.node($from.depth - 1);
                const currentNode = $from.node();

                // 2. Check if the selection is a `codeBlockLine` within `codeBlock`, a
                //    `divider`, or a `file`
                if (
                    (currentNode.type.name === "codeBlockLine" &&
                        parentNode.type.name === "codeBlock") ||
                    (selection instanceof NodeSelection &&
                        (selection.node.type.name === "divider" ||
                            selection.node.type.name === "file"))
                ) {
                    const paragraphNode = schema.nodes.paragraph;
                    if (!paragraphNode) {
                        return false;
                    }

                    if (dispatch) {
                        const insertPosition = 0;
                        const transaction = state.tr;
                        transaction.insert(insertPosition, paragraphNode.create());
                        transaction.setSelection(
                            TextSelection.create(transaction.doc, insertPosition + 1),
                        );
                        dispatch(transaction);
                    }

                    return true;
                }

                return false;
            },
        ),
    );

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
                        state.tr
                            .setSelection(new TextSelection(state.doc.resolve(fromNodeStartPos)))
                            .scrollIntoView(),
                    );
                    return true;
                }
            }
        }

        dispatch?.(
            state.tr
                .setSelection(
                    new TextSelection(state.doc.resolve(fromNodeStartPos + indentationTextLength)),
                )
                .scrollIntoView(),
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
                        state.tr
                            .setSelection(
                                new TextSelection($to, state.doc.resolve(fromNodeStartPos)),
                            )
                            .scrollIntoView(),
                    );
                    return true;
                }
            }
        }

        dispatch?.(
            state.tr
                .setSelection(
                    new TextSelection(
                        $to,
                        state.doc.resolve(fromNodeStartPos + indentationTextLength),
                    ),
                )
                .scrollIntoView(),
        );
        return true;
    });

    // If "Home" is pressed in a file gallery then navigate to the first file in
    // the gallery. A file gallery is defined as the current file row and any
    // adjacent file rows above or below.
    keys.set("Home", (state, dispatch) => {
        if (!(state.selection instanceof NodeSelection)) return false;
        if (state.selection.node.type.name !== "file") return false;

        assert(state.selection.$anchor.parent.type.groups.includes("fileRowLike"));

        let $first = state.doc.resolve(state.selection.$anchor.start());
        assert($first.nodeAfter?.type.name === "file");

        while (true) {
            const $next = state.doc.resolve($first.pos - 1);
            if (!$next.nodeBefore?.type.groups.includes("fileRowLike")) break;

            $first = state.doc.resolve(state.doc.resolve($first.pos - 2).start());
            assert($first.nodeAfter?.type.name === "file");
        }

        const newSelection = new NodeSelection($first);
        if (newSelection && newSelection?.anchor !== state.selection.anchor) {
            dispatch?.(state.tr.setSelection(newSelection).scrollIntoView());
            return true;
        }

        return false;
    });

    // If "End" is pressed in a file gallery then navigate to the last file in
    // the gallery. A file gallery is defined as the current file row and any
    // adjacent file rows above or below.
    keys.set("End", (state, dispatch) => {
        if (!(state.selection instanceof NodeSelection)) return false;
        if (state.selection.node.type.name !== "file") return false;

        assert(state.selection.$anchor.parent.type.groups.includes("fileRowLike"));

        let $last = state.doc.resolve(state.selection.$anchor.end() - 1);
        assert($last.nodeAfter?.type.name === "file");

        while (true) {
            const $next = state.doc.resolve($last.pos + 2);
            if (!$next.nodeAfter?.type.groups.includes("fileRowLike")) break;

            $last = state.doc.resolve(state.doc.resolve($last.pos + 3).end() - 1);
            assert($last.nodeAfter?.type.name === "file");
        }

        const newSelection = new NodeSelection($last);
        if (newSelection && newSelection?.anchor !== state.selection.anchor) {
            dispatch?.(state.tr.setSelection(newSelection).scrollIntoView());
            return true;
        }

        return false;
    });

    // We try to preserve the browser behavior of keeping the cursor in the same X
    // position as it navigates vertically while we navigate through files. This
    // implementation isn't perfect but creates a slightly better experience.
    // Notably we don't know the browsers own X value it's trying to maintain, we
    // only know the X value before selection entered a file gallery.
    let lastArrowNavigationCoordState: {
        setTime: Date;
        coord: number;
        cleanup: () => void;
    } | null = null;

    function setLastArrowNavigationCoordState(coord: number) {
        lastArrowNavigationCoordState?.cleanup();
        lastArrowNavigationCoordState = null;

        const clearLastArrowNavigationCoord = () => {
            if (
                lastArrowNavigationCoordState &&
                // If we just set this ref, don't clear it. We're processing browser events
                // that happened because of the arrow navigation.
                new Date().getTime() - lastArrowNavigationCoordState.setTime.getTime() > 100
            ) {
                lastArrowNavigationCoordState.cleanup();
                lastArrowNavigationCoordState = null;
            }
        };

        document.addEventListener("focus", clearLastArrowNavigationCoord);
        document.addEventListener("blur", clearLastArrowNavigationCoord);
        document.addEventListener("selectionchange", clearLastArrowNavigationCoord);

        lastArrowNavigationCoordState = {
            setTime: new Date(),
            coord,
            cleanup: () => {
                document.removeEventListener("focus", clearLastArrowNavigationCoord);
                document.removeEventListener("blur", clearLastArrowNavigationCoord);
                document.removeEventListener("selectionchange", clearLastArrowNavigationCoord);
            },
        };
    }

    // Forked from `selectVertically()`:
    // https://github.com/ProseMirror/prosemirror-view/blob/d97a3c1f8cecb9d34f426e3d70fd3bd098d5ebf6/src/capturekeys.ts#L247-L264
    //
    // We want to have the same vertical selection logic as ProseMirror but with
    // more accurate navigation based on DOM geometry. So pressing the down arrow
    // on the right side of a text block should go to the rightmost file.
    function selectFileVertically(view: EditorView, dir: number, event: KeyboardEvent) {
        const {state} = view;
        const {selection} = state;
        if ((selection instanceof TextSelection && !selection.empty) || event.shiftKey)
            return false;
        if (getClientInfo().isAppleDevice && event.metaKey) return false;
        const {$from} = selection;

        if (!$from.parent.inlineContent || view.endOfTextblock(dir < 0 ? "up" : "down")) {
            // NOTE(calebmer): If our selection is inside a file then we want to move the
            // selection to a position below (or above) our file based on DOM geometry. Not
            // based on ProseMirror tree layout (which is the default).
            //
            // - If we're moving from a file to a file we'll move to the file below (or
            //   above) ours.
            // - If we're moving from a file to text then we'll select text directly below
            //   our file.
            if (
                selection instanceof NodeSelection &&
                selection.node.type.name === "file" &&
                selection.$anchor.parent.type.groups.includes("fileRowLike")
            ) {
                const fileElement = view.nodeDOM(selection.$anchor.pos);

                if (fileElement instanceof Element) {
                    const fileRect = fileElement.getBoundingClientRect();

                    // Elements that aren't attached to the DOM (so aren't laid out) have a zeroed
                    // out bounding client rect. Ignore these elements.
                    if (
                        fileRect.left !== 0 ||
                        fileRect.right !== 0 ||
                        fileRect.top !== 0 ||
                        fileRect.bottom !== 0
                    ) {
                        const nextElement =
                            dir > 0
                                ? fileElement?.parentElement?.nextElementSibling
                                : fileElement?.parentElement?.previousElementSibling;

                        const nextRect = nextElement?.getBoundingClientRect();

                        const posResult = view.posAtCoords({
                            left:
                                lastArrowNavigationCoordState?.coord ??
                                fileRect.left + (fileRect.right - fileRect.left) / 2,
                            top:
                                dir > 0
                                    ? nextRect
                                        ? nextRect.top + 1
                                        : fileRect.bottom +
                                          convertRemLengthToPx(
                                              contentStyles.paragraphMargin,
                                              getSpacingScaleWithoutListening(),
                                          )
                                    : nextRect
                                    ? nextRect.bottom - 1
                                    : fileRect.top -
                                      convertRemLengthToPx(
                                          contentStyles.paragraphMargin,
                                          getSpacingScaleWithoutListening(),
                                      ),
                        });

                        if (posResult !== null) {
                            let nextSelection = Selection.near(
                                state.doc.resolve(posResult.pos),
                                -dir,
                            );

                            // If moving vertically kept us in the same `fileRow` then try searching for a
                            // selection with a bias in the other direction. This is needed when you have
                            // images in a T shape like this:
                            //
                            // ```
                            //     ┌────────┐┌────────────┐
                            //     │        ││            │
                            //     │  1     ││  2         │
                            //     │        ││            │
                            //     │        ││            │
                            //     └────────┘└────────────┘
                            //            ┌────────┐
                            //            │        │
                            //            │  3     │
                            //            │        │
                            //            │        │
                            //            │        │
                            //            │        │
                            //            └────────┘
                            // ```
                            //
                            // If your selection is in 1 then the coordinate below 1 will be between 2 and
                            // 3. So a bias of -1 selects 2.
                            if (nextSelection.$anchor.parent === selection.$anchor.parent) {
                                nextSelection = Selection.near(
                                    state.doc.resolve(posResult.pos),
                                    dir,
                                );
                            }

                            if (
                                !(nextSelection instanceof NodeSelection) ||
                                nextSelection.node !== selection.node
                            ) {
                                // Preserve the last arrow navigation coord if we used it.
                                if (lastArrowNavigationCoordState)
                                    lastArrowNavigationCoordState.setTime = new Date();

                                view.dispatch(
                                    state.tr.setSelection(nextSelection).scrollIntoView(),
                                );
                                return true;
                            }
                        }
                    }
                }
            }

            const {$anchor, $head} = state.selection;
            const $side = dir > 0 ? $anchor.max($head) : $anchor.min($head);
            const $start = !$side.parent.inlineContent
                ? $side
                : $side.depth
                ? state.doc.resolve(dir > 0 ? $side.after() : $side.before())
                : null;
            const nextSelection = $start && Selection.findFrom($start, dir);

            if (nextSelection && nextSelection instanceof NodeSelection) {
                // NOTE(calebmer): If our selection is moving into a file out of anything else
                // (e.g. paragraph) then we want to move into the file closest to the current
                // selection based on DOM geometry not based on ProseMirror tree order (which
                // is the default).
                //
                // If our current selection is a file and our next selection is a file it
                // should be handled in our branch above. This branch should only happen when
                // the next selection is a file but the current selection is not.
                if (
                    nextSelection.node.type.name === "file" &&
                    nextSelection.$anchor.parent.type.groups.includes("fileRowLike")
                ) {
                    const coords = view.coordsAtPos($side.pos);

                    // Make sure coords exist and isn't entirely zeroed out which ProseMirror may
                    // return when it doesn't have layout information.
                    if (
                        coords &&
                        (coords.top !== 0 ||
                            coords.bottom !== 0 ||
                            coords.left !== 0 ||
                            coords.right !== 0)
                    ) {
                        const coordX = coords.left + (coords.right - coords.left) / 2;

                        const fileRowElement = view.nodeDOM(nextSelection.$anchor.before());
                        const fileRowRect =
                            fileRowElement instanceof Element
                                ? fileRowElement.getBoundingClientRect()
                                : null;

                        const posCoords = {
                            left: coordX,
                            top:
                                dir > 0
                                    ? fileRowRect
                                        ? fileRowRect.top + 1
                                        : coords.bottom +
                                          convertRemLengthToPx(
                                              contentStyles.paragraphMargin,
                                              getSpacingScaleWithoutListening(),
                                          )
                                    : fileRowRect
                                    ? fileRowRect.bottom - 1
                                    : coords.top -
                                      convertRemLengthToPx(
                                          contentStyles.paragraphMargin,
                                          getSpacingScaleWithoutListening(),
                                      ),
                        };

                        const posResult = view.posAtCoords(posCoords);

                        if (posResult !== null) {
                            // Save the last arrow navigation coord we used.
                            setLastArrowNavigationCoordState(coordX);

                            const $pos = state.doc.resolve(posResult.pos);

                            const nextSelection =
                                $pos.nodeAfter?.type.name === "file"
                                    ? new NodeSelection($pos)
                                    : $pos.nodeBefore?.type.name === "file"
                                    ? new NodeSelection(state.doc.resolve($pos.pos - 1))
                                    : Selection.near(state.doc.resolve(posResult.pos), dir);

                            view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
                            return true;
                        }
                    }
                }

                // Since we computed the same `nextSelection` ProseMirror would we might as
                // well return it and save ProseMirror the work.
                view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
                return true;
            }
        }

        return false;
    }

    keys.set("Mod-a", selectAll);

    // Toggle inline formats
    keys.set("Mod-b", createToggleMarkCommand(schema.mark("bold")));
    keys.set("*", createToggleMarkCommand(schema.mark("bold"), {requireNonEmptySelection: true}));

    keys.set("Mod-i", createToggleMarkCommand(schema.mark("italic")));
    keys.set("_", createToggleMarkCommand(schema.mark("italic"), {requireNonEmptySelection: true}));

    keys.set("Mod-shift-x", createToggleMarkCommand(schema.mark("strike")));
    keys.set("~", createToggleMarkCommand(schema.mark("strike"), {requireNonEmptySelection: true}));
    // Since code styling is uncommon we require the shift modifier so we can save
    // Cmd+E for a more common command.
    keys.set("Mod-shift-e", createToggleMarkCommand(schema.mark("code")));
    keys.set("`", createToggleMarkCommand(schema.mark("code"), {requireNonEmptySelection: true}));

    // Highlight overlay
    if (schema.marks.highlight) {
        keys.set("Mod-shift-h", (state, dispatch) => {
            const selection = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

            // Only open highlight color selector if we're selecting some text.
            if (selection.$from.pos === selection.$to.pos) {
                return false;
            }

            let isHighlightSupported = false;
            state.doc.nodesBetween(selection.$from.pos, selection.$to.pos, node => {
                if (!node.inlineContent) return;
                isHighlightSupported ||= node.type.allowsMarkType(schema.marks.highlight!);
            });

            if (!isHighlightSupported) return false;

            dispatch?.(state.tr.setMeta(openContentEditorKeyboardHighlightFloaterMetaKey, true));
            return true;
        });
    }

    const linkCommand: Command = (state, dispatch) => {
        const selection = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

        // Only open highlight color selector if we're selecting some text.
        if (selection.$from.pos === selection.$to.pos) {
            return false;
        }

        let isLinkSupported = false;
        state.doc.nodesBetween(selection.$from.pos, selection.$to.pos, node => {
            if (!node.inlineContent) return;
            isLinkSupported ||= node.type.allowsMarkType(schema.marks.link);
        });

        if (!isLinkSupported) return false;

        dispatch?.(state.tr.setMeta(openContentEditorKeyboardLinkFloaterMetaKey, true));
        return true;
    };

    // Link overlay
    //
    // If you used shift to select text, you're may still be holding shift when
    // hitting the link shortcut. So cmd-shift-l opens the link input as well.
    keys.set("Mod-l", linkCommand);
    keys.set("Mod-shift-l", linkCommand);

    // Comments
    if (schema.marks.comment) {
        keys.set("Mod-shift-c", (state, dispatch) => {
            const selection = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

            // Only open comment input if we're selecting some text.
            if (selection.$from.pos === selection.$to.pos) {
                return false;
            }

            let isCommentSupported = false;
            state.doc.nodesBetween(selection.$from.pos, selection.$to.pos, node => {
                isCommentSupported ||=
                    !!schema.marks.comment && node.type.allowsMarkType(schema.marks.comment);
            });

            if (!isCommentSupported) return false;

            dispatch?.(state.tr.setMeta(openContentEditorCommentInputFloaterMetaKey, true));
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
    if (typeof window !== "undefined" && getClientInfo().isAppleDevice) {
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
            handleKeyDown: (view, event) => {
                // We don't use `prosemirror-keymap` for these event handlers since we want the
                // `KeyboardEvent` itself to mimic the exact implementation from
                // `prosemirror-view` for vertical navigation.
                {
                    if (event.key === "ArrowDown" && selectFileVertically(view, 1, event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        return true;
                    }

                    if (event.key === "ArrowUp" && selectFileVertically(view, -1, event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        return true;
                    }
                }

                // Our codebase convention is to call `event.preventDefault()` and
                // `event.stopPropagation()` whenever a `keydown` event is handled. ProseMirror
                // will only call `event.preventDefault()` when a keydown handler returns true.
                // So construct a plugin where we also call `event.stopPropagation()`.
                //
                // We call `event.stopPropagation()` so global `keydown` handlers don't see
                // events we've already handled. Particularly important for undo where we have
                // a global undo handler and a local undo handler. If our local undo handles
                // the keyboard shortcut we don't want to run our global handler.
                const result = handleKeyDown(view, event);
                if (result) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return result;
            },

            handleTextInput: (view, from, to, text) => {
                const {state} = view;

                // If the user tries to type text while a `file` is selected then instead of
                // replacing the file selection with the text let's create a new paragraph
                // below the file and let the user continue typing there. Files are typically
                // added with a lot of intention from the user so protect them from
                // accidentally deleting their file by typing over it.
                //
                // We have similar logic for the "Enter" keyboard shortcut. We create a
                // paragraph below the file instead of replacing the file.
                if (
                    state.selection instanceof NodeSelection &&
                    state.selection.node.type.name === "file" &&
                    state.selection.$anchor.parent.type.groups.includes("fileRowLike")
                ) {
                    const insertPosition = state.selection.$anchor.after();

                    const transaction = state.tr.insert(
                        insertPosition,
                        schema.node("paragraph", {}, [schema.text(text)]),
                    );

                    view.dispatch(
                        transaction
                            .setSelection(
                                TextSelection.near(
                                    transaction.doc.resolve(insertPosition + 1 + text.length),
                                ),
                            )
                            .scrollIntoView(),
                    );
                    return true;
                }

                return false;
            },
        },
    });
}
