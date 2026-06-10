import {Node, ResolvedPos} from "prosemirror-model";
import {NodeSelection, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {findElementVerticalNavigationPosition} from "~/client/web/content/state/find_element_vertical_navigation_position.js";
import {createParagraphAndMoveSelectionAfterContent} from "~/client/web/content/state/internal/create_paragraph_and_move_selection_after_content.js";
import {
    contentTableCellAround,
    isPosInContentTable,
} from "~/client/web/content/state/table/content_table_client_util.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    ContentInlineNodeTypeName,
    ContentNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Creates an event handler for `<ContentEditor>`'s `ArrowDown` and `ArrowUp`
 * `keydown` events. We implement `ArrowDown`/`ArrowUp` ourselves when moving
 * between blocks to better handle navigation around our custom node types.
 * Specifically `table`s and `fileRow`s. We want to move vertically through `table`
 * and `fileRow` geometrically, not based on document tree order. If we moved in
 * tree order then arrow down in a `tableCell` would move to a `tableCell` to the
 * right instead of the `tableCell` below. Same for `fileRow`s. Generically, moving
 * vertically between "row"-like nodes requires special handling to preserve the x
 * position of the cursor and to make sure we navigate to the next row instead of
 * another element within the row.
 *
 * This function keeps track of the x coordinate of the cursor while we're
 * navigating. This is meant to mimic the browser's own internal x coordinate it
 * uses for vertical arrow key navigation. There are edge cases where our state
 * doesn't exactly equal the browser's state but those cases are rare and the bugs
 * aren't that bad. (Long term we could fix these bugs by doing _all_ vertical
 * arrow key navigation instead of deferring to the browser when navigating within
 * a text block.)
 *
 * At a high level the way this function works is:
 *
 * 1. On any arrow up/down event, keep track of the x position we want to maintain.
 *
 * 2. Check for paragraph creation at end of content. This handles both
 *    file/divider node selection and textblock navigation when at the end of the
 *    document or container.
 *
 * 3. When navigating between two ProseMirror nodes, find the next set of nodes
 *    based on `doc` tree order using `collectNextNodes()`. There may be more then
 *    one `nextNodes` if we're moving into a row-like node (e.g. `fileRow` or
 *    `tableRow`). If there's more than one `nextNode`, pick the node that's
 *    closest to our target x position.
 *
 * 4. If the `nextNode` we picked is a text block, find the position in the text
 *    block that's closest to our x position. We call the function
 *    `findElementVerticalNavigationPosition()` for this.
 *
 * There's more complexity in how the function handles arrow navigations with the
 * `altKey`/`shiftKey` and when the function decides to change the selection itself
 * vs defer to the browser. But at a high level the function follows the above
 * steps.
 */
export function createHandleContentEditorVerticalArrowKeyDown() {
    // When navigating into row content (file rows and table rows) we want to match the
    // browser behavior of preserving the x coordinate from wherever arrow navigation
    // began (standard text editor behavior).
    //
    // NOTE(calebmer, #canvas-text-editor): This is a reason we should build our own
    // text editor from scratch with `<canvas>`. Browsers like Chrome have a property
    // [`x_pos_for_vertical_arrow_navigation`][1] that ideally we'd be able to share
    // here. But no! It's not exposed to JavaScript. Solution: Build our text editor
    // fully in JavaScript.
    //
    // [1]:
    //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/frame_selection.h#L383
    const geometryTracker = new GeometryTracker();

    return (view: EditorView, dir: -1 | 1, event: KeyboardEvent): boolean => {
        const {state} = view;
        const {selection} = state;
        const {$head, $from, $to} = selection;

        /* ========================================================================== *\
         *           1. Decide if we should handle this vertical navigation           *
        \* ========================================================================== */

        // Jump to the start/end of content with cmd-up/down.
        if (getClientInfo().isAppleDevice ? event.metaKey : event.ctrlKey) {
            let newSelection: Selection;

            if (dir < 0) {
                if (!event.shiftKey) {
                    newSelection = Selection.atStart(state.doc);
                } else {
                    newSelection = TextSelection.between($head, state.doc.resolve(0));
                }
            } else {
                if (!event.shiftKey) {
                    newSelection = Selection.atEnd(state.doc);
                } else {
                    newSelection = TextSelection.between(
                        $head,
                        state.doc.resolve(state.doc.content.size),
                    );
                }
            }

            view.dispatch(view.state.tr.setSelection(newSelection).scrollIntoView());
            return true;
        }

        // Keep track of x coordinate state while navigating vertically:
        const trackedTargetX = geometryTracker.threshold(view);
        const movingDown = dir > 0;

        const $pos =
            selection instanceof NodeSelection
                ? $from
                : event.shiftKey
                  ? $head
                  : movingDown
                    ? $to
                    : $from;

        const node = $pos.parent.inlineContent ? $pos.parent : $pos.nodeAfter;

        // NOTE(calebmer): I haven't found a case where `node` doesn't exist but I wouldn't
        // be surprised if it could be null in edge cases like content with a single node
        // that's selected and up/down is pressed.
        if (node === null) return false;

        // If we're in a text block and we're not at the end of the text block then let the
        // browser perform its default navigation. We want to handle all navigation between
        // nodes.
        if (node.isTextblock && !view.endOfTextblock(movingDown ? "down" : "up")) {
            return false;
        }

        // If the user is holding alt and they press arrow up or down then move to the
        // start/end of the textblock first instead of moving to the next adjacent
        // textblock. If alt up/down is pressed again we'll move to the next textblock.
        if (
            event.altKey &&
            $pos.parent.inlineContent &&
            $pos.parentOffset !== (movingDown ? $pos.parent.nodeSize - 2 : 0)
        ) {
            view.dispatch(
                view.state.tr
                    .setSelection(
                        TextSelection.near(
                            $pos.doc.resolve(
                                $pos.pos +
                                    ((movingDown ? $pos.parent.nodeSize - 2 : 0) -
                                        $pos.parentOffset),
                            ),
                        ),
                    )
                    .scrollIntoView(),
            );
            return true;
        }

        /* ========================================================================== *\
         *                 2. Check for paragraph creation at end of content         *
        \* ========================================================================== */

        // Handle navigation when moving down
        if (movingDown && node) {
            let isLastLineInBlock = false;
            let afterSelectedNodePos: number | null = null;

            // Check if we're at the last child in any parent container
            let hitNonLastChild = false;
            for (let depth = $pos.depth - 1; depth > 0; depth--) {
                const parentNode = $pos.node(depth);
                const nodeIndex = $pos.index(depth);
                const isLastChildOfParentNode = nodeIndex === parentNode.childCount - 1;

                // If not last child, we're definitely not at the end
                if (!isLastChildOfParentNode) {
                    hitNonLastChild = true;
                    break;
                }

                if (parentNode.type.name === "table") {
                    // Skip table - it's handled separately below
                    break;
                }

                if (parentNode.type.name === "tableCell") {
                    // Continue checking parent containers
                    continue;
                }

                if (parentNode.type.name === "codeBlock" || parentNode.type.name === "quoteBlock") {
                    // We're at the last child of a codeBlock or quoteBlock
                    isLastLineInBlock = true;
                    afterSelectedNodePos = $pos.after(depth);
                    break;
                }

                // For other containers, set position and continue
                afterSelectedNodePos = $pos.after(depth);
            }

            // This is just a decomposition of selectedContentTableRect into only the parts we
            // need without any extra potentially troublesome logic.
            const $cell = contentTableCellAround($pos);

            // Special check for file rows and dividers
            if (
                selection instanceof NodeSelection &&
                (selection.node.type.name === "file" || selection.node.type.name === "divider")
            ) {
                const isAtEndOfDoc = selection.eq(Selection.atEnd(state.doc));
                const fileRowEnd = $from.end($from.depth);

                const isDivider = selection.node.type.name === "divider";
                const isInLastFileRow = fileRowEnd + 1 === state.doc.content.size;

                if (isAtEndOfDoc && (isInLastFileRow || isDivider)) {
                    afterSelectedNodePos = state.doc.content.size;
                }

                // Also check if we're in a table cell with a file and table is at end of document
                if ($cell) {
                    const table = $cell.node(-1);
                    const tablePos = $cell.start(-1);
                    const afterTablePos = tablePos + table.nodeSize;
                    if (afterTablePos >= state.doc.content.size) {
                        afterSelectedNodePos = state.doc.content.size;
                        isLastLineInBlock = true;
                    }
                }
            }

            if (
                !isLastLineInBlock &&
                !hitNonLastChild &&
                (afterSelectedNodePos === null || $cell)
            ) {
                // If we didn't find any special container (codeBlock/quoteBlock) and we didn't hit
                // a non-last-child then we're at the last line.
                isLastLineInBlock = true;
            }

            if (!$cell) {
                // If we're not in a table, only create paragraph for wrapped blocks
                if (afterSelectedNodePos && afterSelectedNodePos >= state.doc.content.size) {
                    return createParagraphAndMoveSelectionAfterContent(state, view.dispatch);
                }
            } else {
                const table = $cell.node(-1);
                const tablePos = $cell.start(-1);
                const tableMap = ContentTableMap.get(table);
                const rect = tableMap.findCell($cell.pos - tablePos);
                const isLastRow = rect.bottom === tableMap.height;

                if (isLastRow) {
                    // Find the table cell by going up the hierarchy
                    let tableCellDepth = $pos.depth;
                    while (
                        tableCellDepth > 0 &&
                        $pos.node(tableCellDepth).type.name !== "tableCell"
                    ) {
                        tableCellDepth--;
                    }

                    if (tableCellDepth > 0) {
                        const tableCell = $cell.nodeAfter;
                        // Are we the last element in the cell?
                        const isLastChildOfCell =
                            tableCell && $pos.index(tableCellDepth) === tableCell.childCount - 1;

                        if (isLastChildOfCell && isLastLineInBlock) {
                            // We're in the last textblock of the last cell in the last row
                            const afterTablePos = tablePos + table.nodeSize;
                            if (afterTablePos >= state.doc.content.size) {
                                return createParagraphAndMoveSelectionAfterContent(
                                    state,
                                    view.dispatch,
                                );
                            }
                        }
                    }
                }
            }
        }

        /* ========================================================================== *\
         *                 3. Find closest node to target X position                  *
        \* ========================================================================== */

        const nextNodes: Array<{
            $pos: ResolvedPos & {nodeAfter: Node};
        }> = [];

        let hasSkippedNode = false;

        collectNextNodes(
            dir,
            nextNodes,
            assertNodeAfter(
                $pos.parent.inlineContent ? $pos.doc.resolve($pos.before()) : $pos,
                node,
            ),
            {
                skipSelectableNodes: event.shiftKey,
                skipEmptyInlineContentNodes: event.shiftKey,
                onSkipNode: () => {
                    hasSkippedNode = true;
                },
            },
        );

        let closestNextNode: {$pos: ResolvedPos & {nodeAfter: Node}; dom: Element} | null = null;
        let closestDistance = Infinity;

        // When navigating with arrow up/down use `coordState.x` to determine which element
        // to move into. Unless `event.altKey` is held. Then we'll navigate to the
        // left/right edge of the editor.
        const targetX = !event.altKey
            ? trackedTargetX
            : dir < 0
              ? view.dom.getBoundingClientRect().left
              : view.dom.getBoundingClientRect().right;

        for (const nextNode of nextNodes) {
            const dom = view.nodeDOM(nextNode.$pos.pos);
            assert(dom instanceof Element);
            const rect = dom.getBoundingClientRect();

            // If the x coordinate is inside this node's bounds then let's select this node!
            // Otherwise, we look for the node closest to the x coordinate.
            if (rect.left <= targetX && targetX <= rect.right) {
                if (closestDistance > 0) {
                    closestNextNode = {$pos: nextNode.$pos, dom};
                    closestDistance = 0;
                    break;
                }
            } else {
                const distance = Math.abs(targetX - (rect.left + rect.width / 2));
                if (distance < closestDistance) {
                    closestNextNode = {$pos: nextNode.$pos, dom};
                    closestDistance = distance;
                }
            }
        }

        if (closestNextNode === null) {
            // There's no next node to navigate to. Let's return `true` since no navigation
            // needs to happen, right? Unfortunately, wrong. Because of an unfixable bug in
            // `view.endOfTextblock()`.
            //
            // Consider the following text where your cursor is at `|`:
            //
            // ```
            // Concept of the number one tingling of the spine made in the interiors
            // of collapsing stars the sky calls to us dream of the mind's eye as a|
            // patch of light.
            // ```
            //
            // We'd expect `view.endOfTextblock()` to return false here since the cursor isn't
            // in the last line of text. When `view.endOfTextblock()` returns false we
            // `return false` above in this function letting the browser handle navigations
            // within the text block.
            //
            // However, `view.endOfTextblock()` returns true. Because the way
            // `view.endOfTextblock()` works is it gets the coordinate position of the
            // selection and checks if that position is at the bottom of the text block's
            // coordinate position. When you call
            // `window.getSelection().getRangeAt(0).getClientRects()` for the position above
            // you get two rects! One at the end of the line and one at the start of the next
            // line.
            //
            // The coordinate position for this selection is ambiguous! When you're editing and
            // your cursor is near a line break then the cursor can be rendered at either the
            // end of the previous line or the start of the next line while representing the
            // same underlying position. This is more obvious when you consider a string of
            // text without spaces like:
            //
            // ```
            // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxoxxxxxxxxxxxxxxxx
            // ```
            //
            // ...if it line breaks like this:
            //
            // ```
            // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxo
            // xxxxxxxxxxxxxxxx
            // ```
            //
            // ...then your cursor could be rendered here:
            //
            // ```
            // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxo|
            // xxxxxxxxxxxxxxxx
            // ```
            //
            // ...or here:
            //
            // ```
            // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxo
            // |xxxxxxxxxxxxxxxx
            // ```
            //
            // Both represent the same underlying position but look different when rendered on
            // screen.
            //
            // The way this is implemented is browser's have this [`TextAffinity`][1] property
            // on their [internal selection data structure][2] which determines where the
            // cursor should be rendered. But this affinity property isn't readable or writable
            // from JavaScript. I (@calebmer) spent an hour pouring through the Chromium source
            // code looking for a way to figure out the selection affinity to no avail.
            //
            // So, anyway, we'd like to `return true` here. We'd like to definitively know "no
            // more navigation can possibly occur from this position" but unfortunately we
            // don't have that level of control. We must `return false` here to let the browser
            // perform navigation in the case where our cursor is on the second-to-last line in
            // an ambiguous position.
            //
            // NOTE(calebmer, #canvas-text-editor): This is a reason we should build our own
            // text editor from scratch with `<canvas>`. We can control the selection affinity
            // ourselves.
            //
            // [1]:
            //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/text_affinity.h#L34
            // [2]:
            //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/selection_template.h#L143
            return false;
        }

        /* ========================================================================== *\
         *                  4. Set selection within the closest node                  *
        \* ========================================================================== */

        const {$pos: $nextPos, dom} = closestNextNode;
        const nextNode = $nextPos.nodeAfter;

        if (!nextNode.inlineContent) {
            // `nextNode` is expected to either be selectable or have inline content.
            // `collectPossibleNextNode()` is responsible for looking at a proposed next node's
            // type and deciding whether it's a valid `nextNode` and if it's not then
            // `collectPossibleNextNode()` looks for valid nodes nearby (usually by iterating
            // into children).
            //
            // If `selectable` is false then we can't create a new `NodeSelection`.
            assert(nextNode.type.spec.selectable);

            // If the user is holding shift `collectPossibleNextNode()` should never add a
            // selectable element to `nextNodes`. `collectPossibleNextNode()` should only add
            // nodes with inline content.
            assert(!event.shiftKey);

            view.dispatch(view.state.tr.setSelection(new NodeSelection($nextPos)).scrollIntoView());
            return true;
        }
        // If the user holds alt then navigate to the start/end of the textblock instead of
        // the start/end of the adjacent line of text.
        else if (event.altKey) {
            view.dispatch(
                view.state.tr
                    .setSelection(
                        dir < 0
                            ? TextSelection.near($nextPos, 1)
                            : TextSelection.near(
                                  $nextPos.doc.resolve($nextPos.pos + $nextPos.nodeAfter.nodeSize),
                                  -1,
                              ),
                    )
                    .scrollIntoView(),
            );
            return true;
        } else {
            // If the selection started in a text block and we're moving to a text block then
            // if `hasSkippedNode` is false let the browser perform its default vertical
            // selection behavior.
            //
            // That way the browser can maintain its internal x position state. Useful for the
            // following case.
            //
            // Say you have text like this with the cursor represented as `|`:
            //
            // ```
            // Brain is the seed of intelligence citizens of distant epochs
            // consciousness Cambrian explosion rich in mystery the only home we've
            // ever known? A very small stage in a vast cosmic arena great turbulent
            // clouds culture dream of the mind's eye laws of physics something
            // incredible is waiting to be known.
            //
            // Concept of the number one tingling of the spine made |in the interiors
            // of collapsing stars the sky calls to us dream of the mind's eye as a
            // patch of light.
            // ```
            //
            // Pressing up once should move the cursor to the end of the last line:
            //
            // ```
            // Brain is the seed of intelligence citizens of distant epochs
            // consciousness Cambrian explosion rich in mystery the only home we've
            // ever known? A very small stage in a vast cosmic arena great turbulent
            // clouds culture dream of the mind's eye laws of physics something
            // incredible is waiting to be known.|
            //
            // Concept of the number one tingling of the spine made in the interiors
            // of collapsing stars the sky calls to us dream of the mind's eye as a
            // patch of light.
            // ```
            //
            // Pressing up again should move the cursor to the same x position as when we
            // started on the second to last line:
            //
            // ```
            // Brain is the seed of intelligence citizens of distant epochs
            // consciousness Cambrian explosion rich in mystery the only home we've
            // ever known? A very small stage in a vast cosmic arena great turbulent
            // clouds culture dream of the mind's eye laws of physics| something
            // incredible is waiting to be known.
            //
            // Concept of the number one tingling of the spine made in the interiors
            // of collapsing stars the sky calls to us dream of the mind's eye as a
            // patch of light.
            // ```
            //
            // NOTE(calebmer, #canvas-text-editor): This is a reason we should build our own
            // text editor from scratch with `<canvas>`. Browsers like Chrome have a property
            // [`x_pos_for_vertical_arrow_navigation`][1] that ideally we'd be able to
            // read/write here. But no! It's not exposed to JavaScript. Solution: Build our
            // text editor fully in JavaScript.
            //
            // [1]:
            //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/frame_selection.h#L383
            if (
                node.inlineContent &&
                // Don't allow default browser navigation if we're picking between multiple nodes
                // in a row.
                nextNodes.length === 1 &&
                // Don't allow default browser navigation if we're moving into or out of a table.
                isPosInContentTable($pos) === isPosInContentTable($nextPos) &&
                // If we've skipped over a `fileFloat` then we can't allow a browser default
                // navigation which may move into the `fileFloat` we skipped.
                !hasSkippedNode
            ) {
                return false;
            }

            const navPosition = findElementVerticalNavigationPosition(
                movingDown ? "top" : "bottom",
                dom,
                targetX,
            );

            // Element is empty so selection goes at the start of the element.
            if (navPosition === null) {
                view.dispatch(
                    view.state.tr.setSelection(TextSelection.near($nextPos, 1)).scrollIntoView(),
                );
                return true;
            }

            const navPos = view.posAtDOM(navPosition.node, navPosition.offset, dir);
            const $navPos = $nextPos.doc.resolve(navPos);

            let newSelection: Selection;
            if (!event.shiftKey) {
                newSelection = TextSelection.near($navPos, dir);
            }
            // If the user is holding shift to select text then we want our selection to always
            // include at least one character in the new node. Otherwise in some browsers (like
            // Chrome) the rendered selection highlight won't change! So the user won't know
            // they've technically selected up until the start of the next text node.
            else {
                if ($navPos.parent.inlineContent && $navPos.parent.nodeSize > 2) {
                    if (movingDown && $navPos.parentOffset === 0) {
                        newSelection = TextSelection.between(
                            selection.$anchor,
                            $navPos.doc.resolve($navPos.pos + 1),
                        );
                    } else if (dir < 0 && $navPos.parentOffset === $navPos.parent.nodeSize - 2) {
                        newSelection = TextSelection.between(
                            selection.$anchor,
                            $navPos.doc.resolve($navPos.pos - 1),
                        );
                    } else {
                        newSelection = TextSelection.between(selection.$anchor, $navPos);
                    }
                } else {
                    newSelection = TextSelection.between(selection.$anchor, $navPos);
                }
            }

            view.dispatch(view.state.tr.setSelection(newSelection).scrollIntoView());
            return true;
        }
    };
}

function assertNodeAfter($pos: ResolvedPos, node: Node): ResolvedPos & {nodeAfter: Node} {
    assert($pos.nodeAfter === node);
    return $pos as ResolvedPos & {nodeAfter: Node};
}

/**
 * Find candidate nodes for the vertical arrow navigation after `$afterPos` and add
 * them to `nextNodes`. `nextNodes` must either be selectable
 * (`node.type.spec.selectable === true`) or have inline content
 * (`node.inlineContent === true`). We can't select other types of nodes!
 *
 * We start by finding the next node in `doc` tree order. If the next node is a row
 * (`fileRow` or `tableRow`) then we'll add a `nextNode` for each column in the
 * row.
 */
function collectNextNodes(
    dir: -1 | 1,
    nextNodes: Array<{$pos: ResolvedPos & {nodeAfter: Node}}>,
    $afterPos: ResolvedPos & {nodeAfter: Node},
    options: {
        skipSelectableNodes: boolean;
        skipEmptyInlineContentNodes: boolean;
        onSkipNode: (node: Node) => void;
    },
) {
    let $nextPos: (ResolvedPos & {nodeAfter: Node}) | null = null;

    for (let depth = $afterPos.depth; depth >= 0; depth--) {
        if (dir > 0) {
            const nextPos =
                depth === $afterPos.depth
                    ? $afterPos.pos + $afterPos.nodeAfter.nodeSize
                    : $afterPos.after(depth + 1);
            const $maybeNextPos = $afterPos.doc.resolve(nextPos);

            if (
                $maybeNextPos.nodeAfter &&
                // If the next node (in tree order) is a `tableCell` then don't use it as
                // `$nextPos` and instead go up one depth level so we look at the next `tableRow`
                // instead. When navigating vertically we want to go to the cell in the next row
                // above/below instead of the next cell to the left/right.
                $maybeNextPos.nodeAfter.type.name !== "tableCell" &&
                // If the next node (in tree order) is a `file` that's inside a `fileRow` then
                // don't use the `file` as `$nextPos` and instead go up one depth level so we look
                // at the next node (adjacent `fileRow` or otherwise) instead. When navigating
                // vertically we don't want to go to the file to the left/right within the same
                // row. We want to move up/down.
                !(
                    $maybeNextPos.parent.type.groups.includes("fileRowLike") &&
                    $maybeNextPos.nodeAfter.type.name === "file"
                )
            ) {
                $nextPos = assertNodeAfter($maybeNextPos, $maybeNextPos.nodeAfter);
                break;
            }
        } else {
            const nextPos = depth === $afterPos.depth ? $afterPos.pos : $afterPos.before(depth + 1);
            const $maybeNextPos = $afterPos.doc.resolve(nextPos);

            if (
                $maybeNextPos.nodeBefore &&
                // If the next node (in tree order) is a `tableCell` then don't use it as
                // `$nextPos` and instead go up one depth level so we look at the next `tableRow`
                // instead. When navigating vertically we want to go to the cell in the next row
                // above/below instead of the next cell to the left/right.
                $maybeNextPos.nodeBefore.type.name !== "tableCell" &&
                // If the next node (in tree order) is a `file` that's inside a `fileRow` then
                // don't use the `file` as `$nextPos` and instead go up one depth level so we look
                // at the next node (adjacent `fileRow` or otherwise) instead. When navigating
                // vertically we don't want to go to the file to the left/right within the same
                // row. We want to move up/down.
                !(
                    $maybeNextPos.parent.type.groups.includes("fileRowLike") &&
                    $maybeNextPos.nodeBefore.type.name === "file"
                )
            ) {
                $nextPos = assertNodeAfter(
                    $afterPos.doc.resolve($maybeNextPos.pos - $maybeNextPos.nodeBefore.nodeSize),
                    $maybeNextPos.nodeBefore,
                );
                break;
            }
        }
    }

    // If we're at the start or end of the document there's no more nodes to move into.
    if ($nextPos === null) {
        return;
    }

    collectPossibleNextNode(dir, nextNodes, $nextPos, options);
}

function collectPossibleNextNode(
    dir: -1 | 1,
    nextNodes: Array<{$pos: ResolvedPos & {nodeAfter: Node}}>,
    $nextPos: ResolvedPos & {nodeAfter: Node},
    options: {
        skipSelectableNodes: boolean;
        skipEmptyInlineContentNodes: boolean;
        onSkipNode: (node: Node) => void;
    },
) {
    const nextNode = $nextPos.nodeAfter;

    const nextNodeType = nextNode.type.name as Exclude<
        ContentNodeTypeName,
        "doc" | ContentInlineNodeTypeName
    >;

    switch (nextNodeType) {
        // These are text blocks, we can move the selection here.
        case "paragraph":
        case "heading":
        case "title":
        case "codeBlockLine": {
            if (!options.skipEmptyInlineContentNodes || nextNode.childCount > 0) {
                nextNodes.push({$pos: $nextPos});
            } else {
                options.onSkipNode(nextNode);
                collectNextNodes(dir, nextNodes, $nextPos, options);
            }
            break;
        }

        // These are selectable with `NodeSelection`, we can move the selection here.
        case "divider":
        case "file": {
            if (!options.skipSelectableNodes) {
                nextNodes.push({$pos: $nextPos});
            } else {
                options.onSkipNode(nextNode);
                collectNextNodes(dir, nextNodes, $nextPos, options);
            }
            break;
        }

        // These are not selectable but have children. Pick the first or last child
        // (depending on direction) and get next nodes from there.
        case "quoteBlock":
        case "codeBlock":
        case "unorderedListItem":
        case "orderedListItem":
        case "checkListItem":
        case "table":
        case "tableCell": {
            const nextChildNode =
                dir > 0 ? assertExists(nextNode.firstChild) : assertExists(nextNode.lastChild);

            const $nextChildPos = assertNodeAfter(
                dir > 0
                    ? $nextPos.doc.resolve($nextPos.pos + 1)
                    : $nextPos.doc.resolve(
                          $nextPos.pos + nextNode.nodeSize - 1 - nextChildNode.nodeSize,
                      ),
                nextChildNode,
            );

            collectPossibleNextNode(dir, nextNodes, $nextChildPos, options);
            break;
        }

        // For file rows, each individual file is a possible next node and we need to
        // choose which file based on the x coordinate. So iterate through the row and add
        // all child nodes to `nextNodes`.
        case "fileRow":
        case "fileRowTable": {
            if (!options.skipSelectableNodes) {
                nextNode.descendants((node, pos) => {
                    assert(node.type.name === "file");
                    const $pos = $nextPos.doc.resolve($nextPos.pos + 1 + pos);
                    nextNodes.push({$pos: assertNodeAfter($pos, node)});
                    return false;
                });
            } else {
                options.onSkipNode(nextNode);
                collectNextNodes(dir, nextNodes, $nextPos, options);
            }
            break;
        }

        // When navigating into a table row, choose between all the cells in the row
        // depending on the current x coordinate.
        case "tableRow": {
            nextNode.descendants((cellNode, pos) => {
                assert(cellNode.type.name === "tableCell");

                const nextChildNode =
                    dir > 0 ? assertExists(cellNode.firstChild) : assertExists(cellNode.lastChild);

                const $nextChildPos = assertNodeAfter(
                    dir > 0
                        ? $nextPos.doc.resolve($nextPos.pos + 1 + pos + 1)
                        : $nextPos.doc.resolve(
                              $nextPos.pos +
                                  1 +
                                  pos +
                                  cellNode.nodeSize -
                                  1 -
                                  nextChildNode.nodeSize,
                          ),
                    nextChildNode,
                );

                collectPossibleNextNode(dir, nextNodes, $nextChildPos, options);
                return false;
            });
            break;
        }

        // Skip over `fileFloat`s while navigating with arrow keys. We've decided it's too
        // hard to properly handle geometric navigation into a `fileFloat` since the
        // `fileFloat`'s UI position is basically completely unrelated to its position in
        // the ProseMirror `doc` tree.
        case "fileFloat": {
            options.onSkipNode(nextNode);
            collectNextNodes(dir, nextNodes, $nextPos, options);
            break;
        }

        default:
            throw exhaustive(nextNodeType);
    }
}

const selectionChangeIsFromVerticalArrowKeyDownThresholdMs = 100;

/**
 * Keeps track of the X position in pixels while vertically navigating.
 */
class GeometryTracker {
    private _state: {
        x: number;
        setTime: number;
        cleanup: () => void;
    } | null = null;

    public threshold(view: EditorView): number {
        const {state} = view;
        const {selection} = state;
        const {$head, $anchor} = selection;

        if (this._state !== null) {
            this._state.setTime = Date.now();
            return this._state.x;
        }

        const coords = view.coordsAtPos($head.pos, $anchor.pos > $head.pos ? 1 : -1);

        const clear = (event: Event) => {
            if (this._state === null) return;

            if (
                event.type === "selectionchange" &&
                // If we just moved the selection vertically, don't clear it. We're processing
                // browser events that happened because of the arrow navigation.
                Date.now() - this._state.setTime <
                    selectionChangeIsFromVerticalArrowKeyDownThresholdMs
            ) {
                return;
            }

            this._state.cleanup();
            this._state = null;
        };

        view.dom.addEventListener("blur", clear);
        document.addEventListener("selectionchange", clear);

        this._state = {
            x: coords.left,
            setTime: Date.now(),
            cleanup: () => {
                view.dom.removeEventListener("blur", clear);
                document.removeEventListener("selectionchange", clear);
            },
        };

        return this._state.x;
    }
}
