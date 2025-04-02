import {Node} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {convertRemLengthToPx, parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type ContentEditorFileDropTarget = {
    readonly offsetParent: Element | null;
    readonly rect: {
        readonly left: number;
        readonly right: number;
        readonly top: number;
        readonly bottom: number;
    };
    readonly action:
        | {
              readonly type: "InsertFileRow";
              readonly indicator: "Top" | "Left" | "Right";
              readonly pos: number;
          }
        | {
              readonly type: "InsertFileIntoRow";
              readonly indicator: "Top" | "Left" | "Right";
              readonly pos: number;
          }
        | {
              readonly type: "InsertFileIntoTableCell";
              readonly indicator: "Top" | "Bottom";
              readonly pos: number;
          }
        | null;
};

/**
 * Get the targets for dropping a file into our document around some top block
 * index. For performance, we only generate drop targets immediately around the
 * provided top block index. That way there's fewer drop targets to rank when
 * deciding collision.
 *
 * ## Design notes
 *
 * When the user is hovering over a drop target, we should a line between the
 * margins of where the file will go. We do not shift the layout of the
 * document around. Shifting the layout of the document around can be very
 * disruptive while the user is moving their mouse a long distance. It also
 * breaks the user's understanding of where to move their mouse to put the file
 * in a certain position since as the layout changes based on their mouse
 * movement they need to either understand (based on technical implementation)
 * either: 1) the position BEFORE layout shift they need to go to or 2)
 * remember the position AFTER the layout shift since when they move their
 * mouse everything shifts to a new state.
 *
 * A layout shifting design implementation is also challenging to build
 * technically.
 *
 * I (@calebmer) worked on [Airtable's Interface Designer][1] product where we
 * built a layout shifting drop target implementation. It felt wonderful when
 * it worked but there were certainly common annoyances where you'd be dragging
 * to add a small element to a page and you had a difficult time getting it to
 * the right position while the entire page was shifting around you.
 *
 * [1]: https://www.airtable.com/platform/interface-designer
 */
export function getContentEditorFileDropTargets(
    view: EditorView,
    aroundIndex: number,
    draggingFilePos: number | null,
): Array<ContentEditorFileDropTarget> {
    const dropTargets: Array<ContentEditorFileDropTarget> = [];

    const {doc} = view.state;
    const {schema} = doc.type;
    if (!schema.nodes.fileRow) {
        return dropTargets;
    }

    const $draggingFilePos = draggingFilePos !== null ? doc.resolve(draggingFilePos) : null;

    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const nodeCount = doc.content.content.length;
    let seekBackwardsCount = 1;
    let seekForwardsCount = 2;

    let startIndex = aroundIndex;
    if (seekBackwardsCount > 0) {
        for (let i = aroundIndex - 1; i >= 0; i--) {
            const node = doc.content.content[i]!;

            // Ignore floating files. They're not positioned normally in the document so
            // cause drop targets to be rendered in weird positions.
            if (node.type.name === "fileFloat") continue;

            seekBackwardsCount--;

            if (seekBackwardsCount <= 0) {
                startIndex = i;
                break;
            }
        }
    }

    const defaultDropTargetOffsetY =
        convertRemLengthToPx(contentStyles.paragraphMargin, spacingScale) / 2;
    let previousDropTargetOffsetY = defaultDropTargetOffsetY;

    let nextPos = 0;
    let element: HTMLElement | null = null;
    const previousFileFloats: Array<{node: Node; pos: number}> = [];

    for (let i = 0; i < nodeCount; i++) {
        const node = doc.content.content[i]!;

        const pos = nextPos;
        nextPos += node.nodeSize;

        // Ignore floating files. They're not positioned normally in the document so
        // cause drop targets to be rendered in weird positions.
        if (node.type.name === "fileFloat") {
            previousFileFloats.push({node, pos});
            continue;
        }

        // We need the element before `startIndex` but let's not run `view.nodeDOM()`
        // for any other elements.
        if (i < startIndex - 1) continue;

        // If we're past `aroundIndex` then decrement `seekForwardsCount` until we
        // reach 0.
        if (i > aroundIndex) {
            if (seekForwardsCount <= 0) break;
            seekForwardsCount--;
        }

        const currentElement = view.nodeDOM(pos);
        if (!(currentElement instanceof HTMLElement)) continue;
        const lastElement = element;
        element = currentElement;
        if (i < startIndex) continue;

        // Horizontal Drop Target Creation
        if (doc.canReplaceWith(i, i, schema.nodes.fileRow)) {
            // NOCOMMIT: make a reusable function to get the drop target offset for files. use the same in fileRowtable.
            // so this will be fileRowLike
            previousDropTargetOffsetY = lastElement
                ? (element.offsetTop - (lastElement.offsetTop + lastElement.offsetHeight)) / 2
                : defaultDropTargetOffsetY;

            // If heading is at the end of the document and a file is dragged below it,
            // let's use paragraph margin for the drop target offset instead of the
            // heading's margin from above.
            if (node.type.name === "heading") {
                previousDropTargetOffsetY = Math.min(
                    previousDropTargetOffsetY,
                    defaultDropTargetOffsetY,
                );
            }

            let dropTargetY: number;

            // If we are dropping above a `fileRow` then always use the file row gap to
            // offset our drop target rect. Don't save this in `lastDropTargetOffsetY`
            // since this adjustment may not make sense for the last block in our doc.
            if (node.type.name === "fileRow") {
                dropTargetY = element.offsetTop - (contentStyles.fileRowGapWidthRem * remPx) / 2;
            }
            // If we are dropping below a `fileRow` then always use the file row gap to
            // offset our drop target rect. Don't save this in `lastDropTargetOffsetY`
            // since this adjustment may not make sense for the last block in our doc.
            else if (lastElement && doc.content.content[i - 1]!.type.name === "fileRow") {
                dropTargetY =
                    lastElement.offsetTop +
                    lastElement.offsetHeight +
                    (contentStyles.fileRowGapWidthRem * remPx) / 2;
            }
            // If we are dropping above a `heading` then add `lastDropTargetOffsetY` to the
            // last top block element's bottom instead of subtracting it from this top block
            // element's top. Since the heading creates a new section the dropped file
            // should appear to logically be a part of the previous section.
            else if (lastElement && node.type.name === "heading") {
                dropTargetY =
                    lastElement.offsetTop + lastElement.offsetHeight + previousDropTargetOffsetY;
            } else {
                dropTargetY = element.offsetTop - previousDropTargetOffsetY;
            }

            let dropTargetLeft = element.offsetLeft;
            let dropTargetRight = element.offsetLeft + element.offsetWidth;

            // Scan through the `fileFloat`s above us. Check to see our drop target
            // overlaps with any of them. If there is an overlap then update our drop
            // target left/right so we don't draw a drop target over a `fileFloat`. This
            // search takes advantage of a couple facts:
            //
            // - The order of `fileFloat`s in the document represents their same vertical
            //   order on screen. So if `j < k` then we know
            //   `previousFileFloats[j].offsetTop + previousFileFloats[j].offsetHeight <= previousFileFloats[k].offsetTop`.
            //
            // - You can't have two `fileFloat`s at the same X position because all
            //   `fileFloat`s have the CSS `clear: both`.
            for (let j = previousFileFloats.length - 1; j >= 0; j--) {
                const previousFileFloat = previousFileFloats[j]!;
                const fileFloatElement = view.nodeDOM(previousFileFloat.pos);

                if (fileFloatElement instanceof HTMLElement) {
                    // If this float is above the drop target then all other `previousFileFloats`
                    // will similarly be over the drop target. So we can end iteration.
                    if (fileFloatElement.offsetTop + fileFloatElement.offsetHeight < dropTargetY) {
                        break;
                    }

                    if (fileFloatElement.offsetTop < dropTargetY) {
                        if (previousFileFloat.node.attrs.direction === "right") {
                            dropTargetRight = Math.min(
                                dropTargetRight,
                                fileFloatElement.offsetLeft,
                            );
                        } else if (previousFileFloat.node.attrs.direction === "left") {
                            dropTargetLeft = Math.max(
                                dropTargetLeft,
                                fileFloatElement.offsetLeft + fileFloatElement.offsetWidth,
                            );
                        }

                        // Two `fileFloat`s aren't allowed to be at the same X position. Since we set
                        // `clear: "both"` on all `fileFloat`s. So if we find one `fileFloat` that
                        // intersects our drop target we know there won't be any more.
                        break;
                    }
                }
            }

            dropTargets.push({
                offsetParent: element.offsetParent,
                rect: {
                    left: dropTargetLeft,
                    right: dropTargetRight,
                    top: dropTargetY,
                    bottom: dropTargetY,
                },
                action: {
                    type: "InsertFileRow",
                    indicator: "Top",
                    pos,
                },
            });
        }

        const isDraggingFileInParent = $draggingFilePos?.parent === node;

        // Create some dead space with `action: null` if we're dragging the file in
        // this node. The dead space means if the user starts dragging a file, doesn't
        // move their mouse much, then releases the drag will be a noop. Instead of
        // picking a drop target that moves the file above/below the row which would be
        // the default behavior without dead space.
        if (isDraggingFileInParent) {
            const fileElement = element.childNodes[$draggingFilePos.index()];

            if (fileElement instanceof HTMLElement) {
                const elementRect = element.getBoundingClientRect();
                const fileElementRect = fileElement.getBoundingClientRect();

                dropTargets.push({
                    offsetParent: element.offsetParent,
                    rect: {
                        // `fileElement.offsetLeft` also works here instead of looking at
                        // `fileElement.getBoundingClientRect()`. However, `offsetLeft` rounds
                        // positions to integers. For precisely rendering our drop target in the center
                        // of two files we need the fractional position which `getBoundingClientRect()`
                        // returns. Otherwise in some edge cases the drop target looks off center.
                        //
                        // We subtract `elementRect.left` so we get a position relative to
                        // `element.offsetLeft`.
                        left:
                            element.offsetLeft +
                            (fileElementRect.left - elementRect.left) +
                            contentStyles.fileRowGapWidthRem * remPx,
                        right:
                            element.offsetLeft +
                            (fileElementRect.right - elementRect.left) -
                            contentStyles.fileRowGapWidthRem * remPx,
                        top:
                            element.offsetTop +
                            (fileElementRect.top - elementRect.top) +
                            contentStyles.fileRowGapWidthRem * remPx,
                        bottom:
                            element.offsetTop +
                            (fileElementRect.bottom - elementRect.top) -
                            contentStyles.fileRowGapWidthRem * remPx,
                    },
                    action: null,
                });
            }
        }

        // If we're dragging near a file row then also create vertical drop indicators
        // which'll allow you to create a gallery when dropping a file to the left or
        // right.
        if (
            node.type.name === "fileRow" &&
            (node.childCount < 3 || (isDraggingFileInParent && node.childCount < 4))
        ) {
            const elementRect = element.getBoundingClientRect();

            {
                const fileRowLeftElement =
                    element.firstElementChild instanceof HTMLElement
                        ? element.firstElementChild
                        : element;

                const dropTargetX =
                    element.offsetLeft +
                    // `fileRowLeftElement.offsetLeft` also works here instead of looking at
                    // `fileRowLeftElement.getBoundingClientRect()`. However, `offsetLeft` rounds
                    // positions to integers. For precisely rendering our drop target in the center
                    // of two files we need the fractional position which `getBoundingClientRect()`
                    // returns. Otherwise in some edge cases the drop target looks off center.
                    //
                    // We subtract `elementRect.left` so we get a position relative to
                    // `element.offsetLeft`.
                    (fileRowLeftElement.getBoundingClientRect().left - elementRect.left) -
                    (contentStyles.fileRowGapWidthRem * remPx) / 2;

                dropTargets.push({
                    offsetParent: element.offsetParent,
                    rect: {
                        left: 0,
                        right: dropTargetX,
                        top: element.offsetTop,
                        bottom: element.offsetTop + element.offsetHeight,
                    },
                    action: {
                        type: "InsertFileIntoRow",
                        indicator: "Right",
                        pos: pos + 1,
                    },
                });
            }

            if (node.type.name === "fileRow" && node.childCount >= 2) {
                const fileRowLeftElement = element.firstElementChild;

                if (fileRowLeftElement instanceof HTMLElement) {
                    const dropTargetX =
                        element.offsetLeft +
                        // `fileRowLeftElement.offsetLeft + fileRowLeftElement.offsetWidth` also works
                        // here instead of looking at `fileRowLeftElement.getBoundingClientRect()`.
                        // However, `offsetLeft` and `offsetWidth` round positions to integers. For
                        // precisely rendering our drop target in the center of two files we need the
                        // fractional position which `getBoundingClientRect()` returns. Otherwise in
                        // some edge cases the drop target looks off center.
                        //
                        // We subtract `elementRect.left` so we get a position relative to
                        // `element.offsetLeft`.
                        (fileRowLeftElement.getBoundingClientRect().right - elementRect.left) +
                        (contentStyles.fileRowGapWidthRem * remPx) / 2;

                    dropTargets.push({
                        offsetParent: element.offsetParent,
                        rect: {
                            left: dropTargetX,
                            right: dropTargetX,
                            top: element.offsetTop,
                            bottom: element.offsetTop + element.offsetHeight,
                        },
                        action: {
                            type: "InsertFileIntoRow",
                            indicator: "Right",
                            pos: pos + 2,
                        },
                    });
                }
            }

            if (node.type.name === "fileRow" && isDraggingFileInParent && node.childCount >= 3) {
                const fileRowLeftElement = element.firstElementChild?.nextElementSibling;

                if (fileRowLeftElement instanceof HTMLElement) {
                    const dropTargetX =
                        element.offsetLeft +
                        // `fileRowLeftElement.offsetLeft + fileRowLeftElement.offsetWidth` also works
                        // here instead of looking at `fileRowLeftElement.getBoundingClientRect()`.
                        // However, `offsetLeft` and `offsetWidth` round positions to integers. For
                        // precisely rendering our drop target in the center of two files we need the
                        // fractional position which `getBoundingClientRect()` returns. Otherwise in
                        // some edge cases the drop target looks off center.
                        //
                        // We subtract `elementRect.left` so we get a position relative to
                        // `element.offsetLeft`.
                        (fileRowLeftElement.getBoundingClientRect().right - elementRect.left) +
                        (contentStyles.fileRowGapWidthRem * remPx) / 2;

                    dropTargets.push({
                        offsetParent: element.offsetParent,
                        rect: {
                            left: dropTargetX,
                            right: dropTargetX,
                            top: element.offsetTop,
                            bottom: element.offsetTop + element.offsetHeight,
                        },
                        action: {
                            type: "InsertFileIntoRow",
                            indicator: "Right",
                            pos: pos + 3,
                        },
                    });
                }
            }

            {
                const fileRowRightElement =
                    element.lastElementChild instanceof HTMLElement
                        ? element.lastElementChild
                        : element;

                const dropTargetX =
                    element.offsetLeft +
                    // `fileRowRightElement.offsetLeft + fileRowRightElement.offsetWidth` also works
                    // here instead of looking at `fileRowRightElement.getBoundingClientRect()`.
                    // However, `offsetLeft` and `offsetWidth` round positions to integers. For
                    // precisely rendering our drop target in the center of two files we need the
                    // fractional position which `getBoundingClientRect()` returns. Otherwise in
                    // some edge cases the drop target looks off center.
                    //
                    // We subtract `elementRect.left` so we get a position relative to
                    // `element.offsetLeft`.
                    (fileRowRightElement.getBoundingClientRect().right - elementRect.left) +
                    (contentStyles.fileRowGapWidthRem * remPx) / 2;

                dropTargets.push({
                    offsetParent: element.offsetParent,
                    rect: {
                        left: dropTargetX,
                        right: element.offsetParent?.clientWidth ?? dropTargetX,
                        top: element.offsetTop,
                        bottom: element.offsetTop + element.offsetHeight,
                    },
                    action: {
                        type: "InsertFileIntoRow",
                        indicator: "Left",
                        pos: pos + node.nodeSize - 1,
                    },
                });
            }
        }

        if (schema.nodes.fileRowTable && node.type.name === "table" && i === aroundIndex) {
            // Recusrively traverse the table cells and generate all drop targets
            // doing this in a function
            addContentEditorTableFileDropTargets({
                tableNode: node,
                tableElement: element,
                dropTargets,
                tablePos: pos,
                view,
            });
        }
    }

    if (
        seekForwardsCount > 0 &&
        element &&
        doc.canReplaceWith(nodeCount, nodeCount, schema.nodes.fileRow)
    ) {
        seekForwardsCount--;

        const dropTargetY =
            element.offsetTop +
            element.offsetHeight +
            // Reuse the offset between the last two blocks we've seen for the last drop
            // target. e.g. If the last block was a paragraph then we may be using the
            // paragraph's margins. Otherwise the rect (and so droppable indicator) touch
            // the end of the last block which looks weird.
            previousDropTargetOffsetY;

        dropTargets.push({
            offsetParent: element.offsetParent,
            rect: {
                left: element.offsetLeft,
                right: element.offsetLeft + element.offsetWidth,
                top: dropTargetY,
                bottom: dropTargetY,
            },
            action: {
                type: "InsertFileRow",
                indicator: "Top",
                pos: nextPos,
            },
        });
    }
    return dropTargets;
}

function addContentEditorTableFileDropTargets({
    tableNode,
    tableElement,
    dropTargets,
    tablePos,
    view,
}: {
    tableNode: Node;
    tableElement: HTMLElement;
    dropTargets: Array<ContentEditorFileDropTarget>;
    tablePos: number;
    view: EditorView;
}): void {
    assert(tableElement);

    const tableRect = tableElement.getBoundingClientRect();
    const tableCellElements = tableElement.querySelectorAll("td");
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const tableMap = ContentTableMap.get(tableNode);

    // NOTE(rohit): If the table has problems then we don't want to add any drop targets
    // because the table will be normalized soon.
    // NOCOMMIT: add the note which is derived from the PR review and implies why we are adding this check
    if (tableMap.problems && tableMap.problems.length > 0) return;

    // Define a gap size for spacing between node drop targets
    const cellPaddingY = parseRemLength(contentStyles.tableCellPaddingY) * remPx;
    const cellPaddingX = parseRemLength(contentStyles.tableCellPaddingX) * remPx;

    for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
        for (let colIndex = 0; colIndex < tableMap.width; colIndex++) {
            const relativeCellPos = tableMap.positionAt(rowIndex, colIndex, tableNode);
            if (relativeCellPos === null || relativeCellPos === undefined) continue;

            // relativeCellPos is the position of the cell in the table node.
            // tablePos is the position of the table in the document.
            // We need to add 2 to the relative cell position to get the absolute
            // cell paragraph position where the file will be inserted.
            const absoluteCellPos = relativeCellPos + tablePos + 2;

            // Calculate the index in the DOM elements array
            const cellIndex = rowIndex * tableMap.width + colIndex;

            const tableCellElement = assertExists(tableCellElements[cellIndex]);
            const cellRect = tableCellElement.getBoundingClientRect();

            // NOCOMMIT: add a note on why we are asserting and not continuing here
            // get it derived from the PR review
            const rowNode = tableNode.content.content[rowIndex];
            assert(rowNode?.type.name === "tableRow");
            const cellNode = rowNode.content.content[colIndex];
            assert(cellNode?.type.name === "tableCell");

            const cellFragment = cellNode.content;
            let cellContentOffset = absoluteCellPos;

            if (cellFragment.content.length === 0) {
                // Add a drop target for the entire cell (as fallback and for empty cells)
                dropTargets.push({
                    offsetParent: tableElement.offsetParent,
                    rect: {
                        left:
                            tableElement.offsetLeft +
                            (cellRect.left - tableRect.left) +
                            cellPaddingX,
                        right:
                            tableElement.offsetLeft +
                            (cellRect.right - tableRect.left) -
                            cellPaddingX,
                        top: tableElement.offsetTop + (cellRect.top - tableRect.top) + cellPaddingY,
                        bottom:
                            tableElement.offsetTop +
                            (cellRect.bottom - tableRect.top) -
                            cellPaddingY,
                    },
                    action: {
                        type: "InsertFileIntoTableCell",
                        indicator: "Top",
                        pos: absoluteCellPos,
                    },
                });
            } else {
                // Modified: Create drop targets at the top of each node rather than between nodes
                for (let i = 0; i < cellFragment.content.length; i++) {
                    const currentNode = cellFragment.content[i]!;

                    // Position is at the start of the current node
                    const dropTargetPos = cellContentOffset;

                    // Get the DOM node using ProseMirror's nodeDOM instead of direct DOM indexing
                    const currentDOMNode = view.nodeDOM(dropTargetPos);
                    if (!(currentDOMNode instanceof HTMLElement)) continue;

                    const currentRect = currentDOMNode.getBoundingClientRect();

                    // Calculate position at the top of the current node
                    const dropTargetY =
                        tableElement.offsetTop +
                        (currentRect.top - tableRect.top) -
                        cellPaddingY / 2;

                    dropTargets.push({
                        offsetParent: tableElement.offsetParent,
                        rect: {
                            left:
                                tableElement.offsetLeft +
                                (cellRect.left - tableRect.left) +
                                cellPaddingX,
                            right:
                                tableElement.offsetLeft +
                                (cellRect.right - tableRect.left) -
                                cellPaddingX,
                            top: dropTargetY,
                            bottom: dropTargetY,
                        },
                        action: {
                            type: "InsertFileIntoTableCell",
                            indicator: "Top",
                            pos: dropTargetPos,
                        },
                    });

                    // add the size of the current node to the cell content offset
                    cellContentOffset += currentNode.nodeSize;
                }
            }

            // In order to add a bottom drop target we need to make sure:
            // - the cell is not empty
            // - the cell is not just an empty paragraph
            // - the cell has content
            //
            if (
                cellFragment.content.length > 0 &&
                !(
                    cellFragment.content.length === 1 &&
                    cellFragment.content[0]?.type.name === "paragraph" &&
                    cellFragment.content[0]?.content.size === 0
                )
            ) {
                const lastDOMNode = tableCellElement.lastChild;

                if (lastDOMNode instanceof HTMLElement) {
                    const lastRect = lastDOMNode.getBoundingClientRect();

                    // Calculate position at the bottom of the last node
                    const dropTargetY =
                        tableElement.offsetTop +
                        (lastRect.bottom - tableRect.top) +
                        cellPaddingY / 2;

                    dropTargets.push({
                        offsetParent: tableElement.offsetParent,
                        rect: {
                            left:
                                tableElement.offsetLeft +
                                (cellRect.left - tableRect.left) +
                                cellPaddingX,
                            right:
                                tableElement.offsetLeft +
                                (cellRect.right - tableRect.left) -
                                cellPaddingX,
                            top: dropTargetY,
                            bottom: dropTargetY,
                        },
                        action: {
                            type: "InsertFileIntoTableCell",
                            indicator: "Top",
                            pos: cellContentOffset, // Position at the end of all cell content
                        },
                    });
                }
            }
        }
    }
}
