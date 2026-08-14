import {Node} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {getPlatformWithoutListening} from "~/client/web/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {fileClassName} from "~/shared/design/core/constant_class_names.js";
import {parseRemLength, screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";

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
              readonly indicator: "Top";
              readonly pos: number;
          }
        | {
              readonly type: "InsertFileIntoRow";
              readonly indicator: "Top" | "Left" | "Right";
              readonly pos: number;
          }
        | {
              readonly type: "InsertFileRowTable";
              readonly indicator: "Top";
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
 * margins of where the file will go. We do not shift the layout of the document
 * around. Shifting the layout of the document around can be very disruptive while
 * the user is moving their mouse a long distance. It also breaks the user's
 * understanding of where to move their mouse to put the file in a certain position
 * since as the layout changes based on their mouse movement they need to either
 * understand (based on technical implementation) either: 1) the position BEFORE
 * layout shift they need to go to or 2) remember the position AFTER the layout
 * shift since when they move their mouse everything shifts to a new state.
 *
 * A layout shifting design implementation is also challenging to build
 * technically.
 *
 * I (@calebmer) worked on [Airtable's Interface Designer][1] product where we
 * built a layout shifting drop target implementation. It felt wonderful when it
 * worked but there were certainly common annoyances where you'd be dragging to add
 * a small element to a page and you had a difficult time getting it to the right
 * position while the entire page was shifting around you.
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

    const platform = getPlatformWithoutListening();
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];

    const blockWidth = Math.min(
        contentStyles.blockMaxWidthRem[platform] * remPx,
        view.dom.clientWidth - screenPaddingXRem[platform] * remPx * 2,
    );

    const blockNodeCount = doc.content.content.length;
    let seekBackwardsCount = 1;
    let seekForwardsCount = 2;

    let startIndex = aroundIndex;
    if (seekBackwardsCount > 0) {
        for (let i = aroundIndex - 1; i >= 0; i--) {
            const node = doc.content.content[i]!;

            // Ignore floating files. They're not positioned normally in the document so cause
            // drop targets to be rendered in weird positions.
            if (node.type.name === "fileFloat") continue;

            seekBackwardsCount--;

            if (seekBackwardsCount <= 0) {
                startIndex = i;
                break;
            }
        }
    }

    let nextPos = 0;
    let actualPrevious: {node: Node; element: HTMLElement} | null = null;
    const previousFileFloats: Array<{node: Node; pos: number}> = [];

    for (let blockNodeIndex = 0; blockNodeIndex < blockNodeCount; blockNodeIndex++) {
        const node = doc.content.content[blockNodeIndex]!;

        const pos = nextPos;
        nextPos += node.nodeSize;

        // Ignore floating files. They're not positioned normally in the document so cause
        // drop targets to be rendered in weird positions.
        if (node.type.name === "fileFloat") {
            previousFileFloats.push({node: node, pos});
            continue;
        }

        // We need the element before `startIndex` but let's not run `view.nodeDOM()` for
        // any other elements.
        if (blockNodeIndex < startIndex - 1) continue;

        // If we're past `aroundIndex` then decrement `seekForwardsCount` until we reach 0.
        if (blockNodeIndex > aroundIndex) {
            if (seekForwardsCount <= 0) break;
            seekForwardsCount--;
        }

        const element = view.nodeDOM(pos);
        if (!(element instanceof HTMLElement)) continue;
        const previous = actualPrevious;
        actualPrevious = {node, element};
        if (blockNodeIndex < startIndex) continue;

        // Horizontal Drop Target Creation
        if (doc.canReplaceWith(blockNodeIndex, blockNodeIndex, schema.nodes.fileRow)) {
            const dropTargetY = getContentEditorFileDropTargetY({
                previous,
                next: {node, element},
            });

            let dropTargetLeft = (view.dom.clientWidth - blockWidth) / 2;
            let dropTargetRight = dropTargetLeft + blockWidth;

            // Scan through the `fileFloat`s above us. Check to see our drop target overlaps
            // with any of them. If there is an overlap then update our drop target left/right
            // so we don't draw a drop target over a `fileFloat`. This search takes advantage
            // of a couple facts:
            //
            // - The order of `fileFloat`s in the document represents their same vertical order
            //   on screen. So if `j < k` then we know
            //   `previousFileFloats[j].offsetTop + previousFileFloats[j].offsetHeight <= previousFileFloats[k].offsetTop`.
            //
            // - You can't have two `fileFloat`s at the same X position because all
            //   `fileFloat`s have the CSS `clear: both`.
            for (
                let previousFileFloatIndex = previousFileFloats.length - 1;
                previousFileFloatIndex >= 0;
                previousFileFloatIndex--
            ) {
                const previousFileFloat = previousFileFloats[previousFileFloatIndex]!;
                const fileFloatElement = view.nodeDOM(previousFileFloat.pos);

                if (fileFloatElement instanceof HTMLElement) {
                    // If this float is above the drop target then all other `previousFileFloats` will
                    // similarly be over the drop target. So we can end iteration.
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

        // Create some dead space with `action: null` if we're dragging the file in this
        // node. The dead space means if the user starts dragging a file, doesn't move
        // their mouse much, then releases the drag will be a noop. Instead of picking a
        // drop target that moves the file above/below the row which would be the default
        // behavior without dead space.
        if (isDraggingFileInParent) {
            const fileElement = element.childNodes[$draggingFilePos.index()];

            if (fileElement instanceof HTMLElement) {
                const elementRect = element.getBoundingClientRect();
                const fileElementRect = fileElement.getBoundingClientRect();

                dropTargets.push({
                    offsetParent: element.offsetParent,
                    rect: {
                        // `fileElement.offsetLeft` also works here instead of looking at
                        // `fileElement.getBoundingClientRect()`. However, `offsetLeft` rounds positions to
                        // integers. For precisely rendering our drop target in the center of two files we
                        // need the fractional position which `getBoundingClientRect()` returns. Otherwise
                        // in some edge cases the drop target looks off center.
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
                    // positions to integers. For precisely rendering our drop target in the center of
                    // two files we need the fractional position which `getBoundingClientRect()`
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
                        // `fileRowLeftElement.offsetLeft + fileRowLeftElement.offsetWidth` also works here
                        // instead of looking at `fileRowLeftElement.getBoundingClientRect()`. However,
                        // `offsetLeft` and `offsetWidth` round positions to integers. For precisely
                        // rendering our drop target in the center of two files we need the fractional
                        // position which `getBoundingClientRect()` returns. Otherwise in some edge cases
                        // the drop target looks off center.
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
                        // `fileRowLeftElement.offsetLeft + fileRowLeftElement.offsetWidth` also works here
                        // instead of looking at `fileRowLeftElement.getBoundingClientRect()`. However,
                        // `offsetLeft` and `offsetWidth` round positions to integers. For precisely
                        // rendering our drop target in the center of two files we need the fractional
                        // position which `getBoundingClientRect()` returns. Otherwise in some edge cases
                        // the drop target looks off center.
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
                    // fractional position which `getBoundingClientRect()` returns. Otherwise in some
                    // edge cases the drop target looks off center.
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

        if (
            schema.nodes.fileRowTable &&
            node.type.name === "table" &&
            blockNodeIndex === aroundIndex
        ) {
            // Recusrively traverse the table cells and generate all drop targets doing this in
            // a function
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
        actualPrevious !== null &&
        doc.canReplaceWith(blockNodeCount, blockNodeCount, schema.nodes.fileRow)
    ) {
        seekForwardsCount--;

        const dropTargetY = getContentEditorFileDropTargetY({
            previous: actualPrevious,
            next: null,
        });

        const dropTargetLeft = (view.dom.clientWidth - blockWidth) / 2;
        const dropTargetRight = dropTargetLeft + blockWidth;

        dropTargets.push({
            offsetParent: actualPrevious.element.offsetParent,
            rect: {
                left: dropTargetLeft,
                right: dropTargetRight,
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

/**
 * Calculates the vertical offset and spacing for file drop targets between
 * document blocks. This function handles special cases for different block types
 * (fileRow, heading, etc.) to ensure optimal visual placement of drop targets.
 */
function getContentEditorFileDropTargetY({
    previous,
    next,
}: {
    previous: {
        node: Node;
        element: HTMLElement;
    } | null;
    next: {
        node: Node;
        element: HTMLElement;
    } | null;
}): number {
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];

    if (previous === null) {
        if (next === null) {
            return 0;
        } else {
            const hasStandaloneMargin =
                hasStandaloneMarginByContentBlockNodeTypeName[next.node.type.name] ?? false;

            return (
                next.element.offsetTop -
                ((hasStandaloneMargin
                    ? contentStyles.standaloneBlockMarginRem
                    : contentStyles.paragraphMarginRem) *
                    remPx) /
                    2
            );
        }
    } else {
        if (
            next === null ||
            // If the next node is a heading then use the same behavior as if the node is at
            // the end of a document. So we don't render the drop target in the middle of the
            // heading's margin.
            next.node.type.name === "heading"
        ) {
            const hasStandaloneMargin =
                hasStandaloneMarginByContentBlockNodeTypeName[previous.node.type.name] ?? false;

            return (
                previous.element.offsetTop +
                previous.element.offsetHeight +
                ((hasStandaloneMargin
                    ? contentStyles.standaloneBlockMarginRem
                    : contentStyles.paragraphMarginRem) *
                    remPx) /
                    2
            );
        } else {
            // Fallthrough. So the most complicated branch isn't indented.
        }
    }

    // If we are dropping adjacent to a `fileRow` then always use the file row gap to
    // offset our drop target rect.
    if (previous.node.type.groups.includes("fileRowLike")) {
        return (
            previous.element.offsetTop +
            previous.element.offsetHeight +
            (contentStyles.fileRowGapWidthRem * remPx) / 2
        );
    } else if (next.node.type.groups.includes("fileRowLike")) {
        return next.element.offsetTop - (contentStyles.fileRowGapWidthRem * remPx) / 2;
    }

    const previousBottom = previous.element.offsetTop + previous.element.offsetHeight;
    const nextTop = next.element.offsetTop;

    return previousBottom + (nextTop - previousBottom) / 2;
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
    // Find all table cell elements but exclude elements that are children of a file
    // node. File entities may recursively render content (e.g. document file
    // entities). The content within file entities is inert so shouldn't get any
    // interactive behaviors.
    const tableCellElements = tableElement.querySelectorAll(`td:not(.${fileClassName} td)`);
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const tableMap = ContentTableMap.get(tableNode);

    // NOTE(rohit): If the table has problems then we don't want to add any drop
    // targets because the table will be normalized soon.
    //
    // Tables can temporarily be in an invalid state (e.g. missing cells in a row)
    // before being normalized. Rather than throwing assertions when we encounter these
    // invalid states, which would crash the app, we simply don't generate any drop
    // targets. This allows us to use a direct coding style with assertions below while
    // gracefully handling corrupted tables.
    if (tableMap.problems && tableMap.problems.length > 0) return;

    const cellPaddingX = parseRemLength(contentStyles.tableCellPaddingX) * remPx;
    const cellPaddingY = parseRemLength(contentStyles.tableCellPaddingY) * remPx;

    for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
        for (let columnIndex = 0; columnIndex < tableMap.width; columnIndex++) {
            const relativeCellPos = tableMap.positionAt(rowIndex, columnIndex);
            if (relativeCellPos === null || relativeCellPos === undefined) continue;

            // relativeCellPos is the position of the cell in the table node. tablePos is the
            // position of the table in the document. We need to add 2 to the relative cell
            // position to get the absolute cell paragraph position where the file will be
            // inserted.
            const absoluteCellPos = relativeCellPos + tablePos + 2;

            // Calculate the index in the DOM elements array
            const cellIndex = rowIndex * tableMap.width + columnIndex;

            const cellElement = assertExists(tableCellElements[cellIndex]);
            const cellRect = cellElement.getBoundingClientRect();

            const cellTop = tableElement.offsetTop + (cellRect.top - tableRect.top);
            const cellBottom = tableElement.offsetTop + (cellRect.bottom - tableRect.top);
            const cellLeft = tableElement.offsetLeft + (cellRect.left - tableRect.left);
            const cellRight = tableElement.offsetLeft + (cellRect.right - tableRect.left);

            const minDropTargetY = cellTop + cellPaddingY;
            const maxDropTargetY = cellBottom - cellPaddingY;

            // NOTE: using direct coding style to assert that the row and cell nodes are valid
            // instead of continuing here. We don't expect these assertions to throw because we
            // check for table problems above. But if it does, it's better to fail fast.
            const rowNode = tableNode.content.content[rowIndex];
            assert(rowNode?.type.name === "tableRow");
            const cellNode = rowNode.content.content[columnIndex];
            assert(cellNode?.type.name === "tableCell");

            const cellFragment = cellNode.content;

            const isCellEmpty =
                cellFragment.content.length === 1 &&
                cellFragment.content[0]?.type.name === "paragraph" &&
                cellFragment.content[0]?.content.size === 0;

            let dropTargetPos = absoluteCellPos;
            let actualPrevious: {node: Node; element: HTMLElement} | null = null;

            // Modified: Create drop targets at the top of each node rather than between nodes
            for (let i = 0; i < cellFragment.content.length; i++) {
                const node = cellFragment.content[i]!;

                // Get the DOM node using ProseMirror's nodeDOM instead of direct DOM indexing
                const element = view.nodeDOM(dropTargetPos);
                if (!(element instanceof HTMLElement)) continue;

                const previous = actualPrevious;
                actualPrevious = {node, element};

                const dropTargetY = clamp(
                    minDropTargetY,
                    cellTop +
                        getContentEditorFileDropTargetY({
                            previous,
                            next: {node, element},
                        }),
                    maxDropTargetY,
                );

                dropTargets.push({
                    offsetParent: tableElement.offsetParent,
                    rect: {
                        left: cellLeft + cellPaddingX,
                        right: cellRight - cellPaddingX,
                        top: dropTargetY,
                        bottom: !isCellEmpty
                            ? dropTargetY
                            : // Extend the last drop target to the bottom of the cell so if the cell is tall
                              // dragging a file anywhere in the cell will drop into the cell.
                              cellBottom - cellPaddingY,
                    },
                    action: {
                        type: "InsertFileRowTable",
                        indicator: "Top",
                        pos: dropTargetPos,
                    },
                });

                // add the size of the current node to the cell content offset
                dropTargetPos += node.nodeSize;
            }

            // In order to add a bottom drop target we need to make sure:
            //
            // - the cell is not empty
            // - the cell is not just an empty paragraph
            // - the cell has content
            if (actualPrevious !== null && !isCellEmpty) {
                const dropTargetY = clamp(
                    minDropTargetY,
                    cellTop +
                        getContentEditorFileDropTargetY({
                            previous: actualPrevious,
                            next: null,
                        }),
                    maxDropTargetY,
                );

                dropTargets.push({
                    offsetParent: tableElement.offsetParent,
                    rect: {
                        left: cellLeft + cellPaddingX,
                        right: cellRight - cellPaddingX,
                        top: dropTargetY,
                        // Extend the last drop target to the bottom of the cell so if the cell is tall
                        // dragging a file anywhere in the cell will drop into the cell.
                        bottom: cellBottom - cellPaddingY,
                    },
                    action: {
                        type: "InsertFileRowTable",
                        indicator: "Top",
                        pos: dropTargetPos,
                    },
                });
            }
        }
    }
}
