import {Attrs, Mark, Node, NodeType, ResolvedPos} from "prosemirror-model";
import {Command, TextSelection, Transaction} from "prosemirror-state";
import {findWrapping} from "prosemirror-transform";
import {assert} from "~/shared/helpers/control/assert.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

/**
 * Get an array of marks that apply to all inline nodes in a given range that
 * support that mark. So if you have an inline node in the middle of the range
 * (e.g. a horizontal divider) that can't be bold, if the surrounding nodes are
 * bold then we will return the bold mark in this array.
 */
export function getMarksSpanningAcrossEntireRange(
    parentNode: Node,
    range: {from: number; to: number},
): ReadonlyArray<Mark> {
    range = trimSpacesFromProsemirrorRange(parentNode, range);

    const previousInlineNodes: Array<{node: Node; $pos: ResolvedPos}> = [];
    let marks: Array<Mark> | null = null;

    parentNode.nodesBetween(range.from, range.to, (node, pos) => {
        if (!node.isInline) return;

        const $pos = parentNode.resolve(pos);

        if (marks === null) {
            marks = [...node.marks];
        } else {
            const newMarks = [];

            // `newMarks` should be the intersection of `mark` and `node.marks`. Unless
            // `node.marks` has a mark that wasn't applicable for previous inline nodes.
            for (const mark of node.marks) {
                if (mark.isInSet(marks)) {
                    newMarks.push(mark);
                }
                // If this node's mark was not in our existing marks set but that was because
                // no previous inline node supported it, then we want to include the mark in
                // `newMarks`.
                else if (
                    previousInlineNodes.every(
                        previousInlineNode =>
                            !previousInlineNode.$pos.parent.type.allowsMarkType(mark.type),
                    )
                ) {
                    newMarks.push(mark);
                }
            }

            // For all our previous marks, add any to `newMark` that are not supported by
            // this node.
            //
            // This way we still count a mark as spanning across an entire range even if
            // there are some intermediate nodes that don't support the mark.
            for (const mark of marks) {
                if (!$pos.parent.type.allowsMarkType(mark.type)) {
                    newMarks.push(mark);
                }
            }

            marks = newMarks;
        }

        previousInlineNodes.push({node, $pos});
    });

    return marks ?? [];
}

/**
 * Creates a command that toggles the provided mark on and off in the
 * `EditorState` selection.
 *
 * Different from the built-in `toggleMark()` command in that if some nodes
 * already have the mark we toggle on instead of off. We believe this is a more
 * intuitive UX for a user when they execute this command through a button
 * press or keyboard shortcut.
 */
export function createToggleMarkCommand(mark: Mark): Command {
    return (state, dispatch) => {
        let doesAnyNodeAllowMarkType = false;
        let doesEveryNodeAlreadyHaveMarkType: boolean | undefined;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found one node that can become our mark type we don't need to
            // keep iterating.
            if (doesAnyNodeAllowMarkType) return false;

            // Ignore nodes that aren't inline.
            if (!node.isInline) return;

            // Ignore nodes that don't support our mark type.
            const $pos = state.doc.resolve(pos);
            if (!$pos.parent.type.allowsMarkType(mark.type)) return;

            if (mark.isInSet(node.marks)) {
                if (doesEveryNodeAlreadyHaveMarkType === undefined)
                    doesEveryNodeAlreadyHaveMarkType = true;
                return;
            }

            doesEveryNodeAlreadyHaveMarkType = false;
            doesAnyNodeAllowMarkType = true;
        });

        // If there were no nodes then this variable is false.
        if (doesEveryNodeAlreadyHaveMarkType === undefined)
            doesEveryNodeAlreadyHaveMarkType = false;

        // If you hit Cmd-B then type, the text should be bold. That's what stored
        // marks do.
        let changedStoredMarks = false;
        if (state.selection instanceof TextSelection && state.selection.$cursor) {
            if (mark.type.isInSet(state.storedMarks ?? state.selection.$cursor.marks())) {
                dispatch?.(state.tr.removeStoredMark(mark.type));
            } else {
                dispatch?.(state.tr.addStoredMark(mark));
            }
            changedStoredMarks = true;
        }

        if (doesEveryNodeAlreadyHaveMarkType) {
            dispatch?.(
                state.tr
                    .removeMark(state.selection.from, state.selection.to, mark)
                    .scrollIntoView(),
            );
            return true;
        }

        if (doesAnyNodeAllowMarkType) {
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
            dispatch?.(state.tr.addMark(range.from, range.to, mark).scrollIntoView());
            return true;
        }

        return changedStoredMarks;
    };
}

/**
 * Creates a command that toggles the provided block type on and off in the
 * `EditorState` selection. Toggling "off" means setting the block back to the
 * paragraph block type.
 *
 * If some nodes in the selection already have the provided block type then
 * this command toggles on.
 */
export function createToggleBlockTypeCommand(
    nodeType: NodeType,
    attrs: Attrs | null = null,
): Command {
    return (state, dispatch) => {
        let canAnyNodeBecomeBlockType = false;
        let isEveryNodeAlreadyBlockType: boolean | undefined;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found one node that can become our block type we don't need to
            // keep iterating.
            if (canAnyNodeBecomeBlockType) return false;

            // Ignore nodes that aren't text blocks.
            if (!node.isTextblock) return;

            if (node.hasMarkup(nodeType, attrs)) {
                if (isEveryNodeAlreadyBlockType === undefined) isEveryNodeAlreadyBlockType = true;
                return;
            }

            // If we see one node that doesn't match the block type, set to false.
            isEveryNodeAlreadyBlockType = false;

            if (node.type === nodeType) {
                canAnyNodeBecomeBlockType = true;
            } else {
                const $pos = state.doc.resolve(pos);
                const index = $pos.index();
                if ($pos.parent.canReplaceWith(index, index + 1, nodeType)) {
                    canAnyNodeBecomeBlockType = true;
                }
            }
        });

        // If there were no nodes then this variable is false.
        if (isEveryNodeAlreadyBlockType === undefined) isEveryNodeAlreadyBlockType = false;

        if (isEveryNodeAlreadyBlockType) {
            assert(state.schema.nodes.paragraph);
            dispatch?.(
                state.tr
                    .setBlockType(
                        state.selection.from,
                        state.selection.to,
                        state.schema.nodes.paragraph,
                    )
                    .scrollIntoView(),
            );
            return true;
        }

        if (canAnyNodeBecomeBlockType) {
            dispatch?.(
                state.tr
                    .setBlockType(state.selection.from, state.selection.to, nodeType, attrs)
                    .scrollIntoView(),
            );
            return true;
        }

        return false;
    };
}

/**
 * Are all nodes the provided block type?
 *
 * If true then we expect `createToggleBlockTypeCommand()` to toggle the block
 * type off.
 */
export function areAllNodesBlockType(
    parentNode: Node,
    range: {from: number; to: number},
    nodeType: NodeType,
    attrs: Attrs | null = null,
): boolean {
    let areAllNodesBlockType: boolean | undefined;

    parentNode.nodesBetween(range.from, range.to, node => {
        if (areAllNodesBlockType === false) return false;
        if (!node.isTextblock) return;

        if (node.hasMarkup(nodeType, attrs)) {
            areAllNodesBlockType = true;
            return;
        }

        areAllNodesBlockType = false;
    });

    return areAllNodesBlockType ?? false;
}

/**
 * Creates a command that toggles list items on and off for the `EditorState`
 * selection.
 *
 * Different from `createToggleBlockTypeCommand()` in that:
 *
 * - Each paragraph becomes a separate list item. Instead of all paragraphs
 *   going into the same list item.
 * - If there's a list item node within the selection then we convert it to the
 *   new list item type and preserve indentation.
 */
export function createToggleListItemsCommand(nodeType: NodeType): Command {
    assert(nodeType.groups.includes("listItem"));

    return (state, dispatch) => {
        const toggleOnTransforms: Array<(transaction: Transaction) => Transaction> = [];
        const toggleOffTransforms: Array<(transaction: Transaction) => Transaction> = [];

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            const $pos = state.doc.resolve(pos);
            const range = $pos.blockRange(state.doc.resolve(pos + node.nodeSize));

            if (range) {
                // If this node is already the list item node type, we want to remove the
                // list item style if all other nodes are also of the list item type.
                if (node.type === nodeType) {
                    const $contentPos = state.doc.resolve(pos + 1);
                    const contentRange = $contentPos.blockRange(
                        state.doc.resolve(pos + node.nodeSize - 1),
                    );
                    assert(contentRange);
                    toggleOffTransforms.push(tr => tr.lift(contentRange, $contentPos.depth - 1));
                }
                // If the node is another list item node type then we want to keep the node as
                // a list item but switch it to our list item node type.
                else if (node.type.groups.includes("listItem")) {
                    toggleOnTransforms.push(tr =>
                        tr.setNodeMarkup(pos, nodeType, {indent: node.attrs.indent}),
                    );
                }
                // If the node is a text block (paragraph probably) then wrap it in a list item
                // if possible.
                else if (node.isTextblock) {
                    const wrapping = findWrapping(range, nodeType);
                    if (wrapping) {
                        toggleOnTransforms.push(tr => tr.wrap(range, wrapping));
                    }
                }
            }
        });

        if (toggleOnTransforms.length === 0 && toggleOffTransforms.length === 0) {
            return false;
        }

        dispatch?.(
            // If there are some non-list nodes that can be toggled on then we're toggling
            // on. Otherwise toggle off by lifting list items.
            (toggleOnTransforms.length > 0 ? toggleOnTransforms : toggleOffTransforms)
                // We `reduceRight()` and apply our transforms in reverse because they affect
                // the doc in ascending `pos` order. So each transform may adjust the positions
                // in the doc after the content it changes. By applying in reverse order each
                // transform won't affect the next transforms position.
                .reduceRight((tr, transform) => transform(tr), state.tr)
                .scrollIntoView(),
        );
        return true;
    };
}

/**
 * Are all nodes the provided list item type?
 *
 * If true then we expect `createToggleListItemsCommand()` to toggle the block
 * type off.
 */
export function areAllNodesListItemType(
    parentNode: Node,
    range: {from: number; to: number},
    nodeType: NodeType,
) {
    assert(nodeType.groups.includes("listItem"));

    let areAllNodesListItemType: boolean | undefined;

    parentNode.nodesBetween(range.from, range.to, (node, pos) => {
        if (areAllNodesListItemType === false) return false;

        const $pos = parentNode.resolve(pos);
        const blockRange = $pos.blockRange(parentNode.resolve(pos + node.nodeSize));

        if (blockRange) {
            if (node.type === nodeType) {
                areAllNodesListItemType = true;
            } else if (node.type.groups.includes("listItem")) {
                areAllNodesListItemType = false;
            } else if (node.isTextblock) {
                const wrapping = findWrapping(blockRange, nodeType);
                if (wrapping) {
                    areAllNodesListItemType = false;
                }
            }
        }
    });

    return areAllNodesListItemType ?? false;
}
