import {NodeType} from "prosemirror-model";
import {Command, Transaction} from "prosemirror-state";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Creates a command that converts list items in the same visual list segment and
 * indentation level as the cursor position to a different list item type.
 *
 * Stops at any non-list item or list item with a lower indent, which separates
 * distinct lists at the clicked indentation level.
 */
export function createConvertListItemsAtIndentCommand(targetNodeType: NodeType): Command {
    assert(targetNodeType.groups.includes("listItem"));

    return (state, dispatch) => {
        const {doc, selection} = state;
        const $pos = doc.resolve(selection.from);

        let listItemDepth: number | null = null;
        let currentListItemIndex: number | null = null;

        // Walk up from the selection to find the containing list item.
        for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth);
            if (node.type.groups.includes("listItem")) {
                listItemDepth = depth;
                currentListItemIndex = $pos.index(depth - 1);
                break;
            }
        }

        if (listItemDepth === null || currentListItemIndex === null) {
            return false;
        }

        // `currentListItemIndex` is relative to the list item's actual parent, which may
        // be a quote block, table cell, or the root document.
        const parent = $pos.node(listItemDepth - 1);
        const parentStartPosition = $pos.start(listItemDepth - 1);
        const currentListItem = parent.child(currentListItemIndex);
        const targetIndent = currentListItem.attrs.indent;

        let startIndex = currentListItemIndex;
        // Expand backward to the start of this visual list segment.
        while (startIndex > 0) {
            const prevNode = parent.child(startIndex - 1);

            if (
                prevNode.type.groups.includes("listItem") &&
                prevNode.attrs.indent >= targetIndent
            ) {
                startIndex--;
            } else {
                break;
            }
        }

        let endIndex = currentListItemIndex;
        // Expand forward to the end of this visual list segment.
        while (endIndex < parent.childCount - 1) {
            const nextNode = parent.child(endIndex + 1);

            if (
                nextNode.type.groups.includes("listItem") &&
                nextNode.attrs.indent >= targetIndent
            ) {
                endIndex++;
            } else {
                break;
            }
        }

        const transforms: Array<(transaction: Transaction) => Transaction> = [];

        // ProseMirror positions are absolute, so convert the parent-relative sibling index
        // into a document position before setting node markup.
        let position = parentStartPosition;
        // Skip siblings before the segment to find the segment's first absolute position.
        for (let i = 0; i < startIndex; i++) {
            position += parent.child(i).nodeSize;
        }

        // Convert only siblings at the clicked indentation level within the segment.
        for (let i = startIndex; i <= endIndex; i++) {
            const node = parent.child(i);
            const nodePosition = position;
            position += node.nodeSize;

            if (node.attrs.indent === targetIndent && node.type !== targetNodeType) {
                if (targetNodeType.name === "checkListItem") {
                    transforms.push(tr =>
                        tr.setNodeMarkup(nodePosition, targetNodeType, {
                            indent: targetIndent,
                            checked: false,
                        }),
                    );
                } else {
                    transforms.push(tr =>
                        tr.setNodeMarkup(nodePosition, targetNodeType, {
                            indent: targetIndent,
                        }),
                    );
                }
            }
        }

        if (transforms.length === 0) {
            return false;
        }

        dispatch?.(
            transforms.reduceRight((tr, transform) => transform(tr), state.tr).scrollIntoView(),
        );
        return true;
    };
}
