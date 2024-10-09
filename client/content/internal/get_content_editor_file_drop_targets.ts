import {Node} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {contentStyles} from "~/client/styles/styles.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";

export type ContentEditorFileDropTarget = {
    readonly offsetParent: Element | null;
    readonly indicator: "Top" | "Left" | "Right";
    readonly rect: {
        readonly left: number;
        readonly right: number;
        readonly top: number;
        readonly bottom: number;
    };
    readonly action:
        | {
              readonly type: "InsertFileRow";
              readonly pos: number;
          }
        | {
              readonly type: "InsertFileIntoRow";
              readonly pos: number;
          };
};

// TODO(calebmer, #files): Implement scroll while dragging.

// TODO(calebmer, #files): Images with alpha does placeholder show through? We
// probably need some fade animation.

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
    if (!schema.nodes.fileRow) return dropTargets;

    const $draggingFilePos = draggingFilePos !== null ? doc.resolve(draggingFilePos) : null;

    const remPx = getRemPxWithoutListening();
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
        convertRemLengthToPx(spacing[contentStyles.defaultParagraphMargin], remPx) / 2;
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

        if (doc.canReplaceWith(i, i, schema.nodes.fileRow)) {
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
                indicator: "Top",
                rect: {
                    left: dropTargetLeft,
                    right: dropTargetRight,
                    top: dropTargetY,
                    bottom: dropTargetY,
                },
                action: {
                    type: "InsertFileRow",
                    pos,
                },
            });
        }

        const isDraggingFileInRow = $draggingFilePos?.parent === node;

        // If we're dragging near a file row then also create vertical drop indicators
        // which'll allow you to create a gallery when dropping a file to the left or
        // right.
        if (
            node.type.name === "fileRow" &&
            (node.childCount < 3 || (isDraggingFileInRow && node.childCount < 4))
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
                    indicator: "Right",
                    rect: {
                        left: 0,
                        right: dropTargetX,
                        top: element.offsetTop,
                        bottom: element.offsetTop + element.offsetHeight,
                    },

                    action: {
                        type: "InsertFileIntoRow",
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
                        indicator: "Right",
                        rect: {
                            left: dropTargetX,
                            right: dropTargetX,
                            top: element.offsetTop,
                            bottom: element.offsetTop + element.offsetHeight,
                        },
                        action: {
                            type: "InsertFileIntoRow",
                            pos: pos + 2,
                        },
                    });
                }
            }

            if (node.type.name === "fileRow" && isDraggingFileInRow && node.childCount >= 3) {
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
                        indicator: "Right",
                        rect: {
                            left: dropTargetX,
                            right: dropTargetX,
                            top: element.offsetTop,
                            bottom: element.offsetTop + element.offsetHeight,
                        },
                        action: {
                            type: "InsertFileIntoRow",
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
                    indicator: "Left",
                    rect: {
                        left: dropTargetX,
                        right: element.offsetParent?.clientWidth ?? dropTargetX,
                        top: element.offsetTop,
                        bottom: element.offsetTop + element.offsetHeight,
                    },
                    action: {
                        type: "InsertFileIntoRow",
                        pos: pos + node.nodeSize - 1,
                    },
                });
            }
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
            indicator: "Top",
            rect: {
                left: element.offsetLeft,
                right: element.offsetLeft + element.offsetWidth,
                top: dropTargetY,
                bottom: dropTargetY,
            },
            action: {
                type: "InsertFileRow",
                pos: nextPos,
            },
        });
    }

    return dropTargets;
}
