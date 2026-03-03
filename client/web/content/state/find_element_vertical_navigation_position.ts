import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Find the position within `Element` we'll navigate to when the user is pressing
 * the up or down arrow to navigate. If `side` is `"top"` the user is navigating
 * down and if side is `"bottom"` the user is navigating up. `targetX` is the x
 * screen coordinate the user is navigating to.
 *
 * If the user is navigating down then we want to find the closest position to
 * `targetX` in the first line of text. If the user is navigating up then we want
 * to find the closest position to `targetX` in the last line of text. If the
 * first/last line of text doesn't contain `targetX` then we'll return a position
 * at the start/end of the line whichever is closer to `targetX`.
 *
 * We return a DOM `node` and `offset` within the node. This mirrors the browser
 * `Selection` API's `Selection.anchorNode` and `Selection.anchorOffset`. If `node`
 * is a text node then `offset` is the number of characters in `node` preceding the
 * position. If `node` is an element then `offset` is the number of child nodes
 * preceding the position.
 *
 * We don't use `document.caretPositionFromPoint()`/
 * `document.caretRangeFromPoint()` ([which ProseMirror uses in
 * `view.posAtCoords()`][1]) since we can't guarantee the position will be inside
 * any `element`. For example, if the text element we want to navigate to is
 * covered by a header then `document.caretPositionFromPoint()`/
 * `document.caretRangeFromPoint()` will return a position in the header!
 *
 * Instead, we iterate through every character at either the top or bottom of the
 * element and find the position that's the closest to `targetX`.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-view/blob/d27ff92999b2aedca18c34efaab8fa5e695dcc8f/src/domcoords.ts#L250-L260
 */
export function findElementVerticalNavigationPosition(
    side: "top" | "bottom",
    element: Element,
    targetX: number,
): {
    node: Text;
    offset: number;
} | null {
    let targetY: number | null = null;
    let bestPosition: {node: Text; offset: number} | null = null;
    let secondBestPosition: {node: Text; offset: number} | null = null;
    let bestDistance = Infinity;
    let isLastPositionBest = false;

    for (let node = getNextNode(element); node !== null; node = getNextNode(node)) {
        assert(node !== element);
        assert(element.contains(node));

        if (!(node instanceof Text)) continue;

        for (
            let offset = side === "top" ? 0 : node.data.length;
            side === "top" ? offset <= node.data.length : offset >= 0;
            side === "top" ? offset++ : offset--
        ) {
            const range = element.ownerDocument.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset);

            const rangeRect = range.getBoundingClientRect();
            const rangeX = rangeRect.x + rangeRect.width / 2;

            // Keep iterating while we're on the same line of text, once the line of text
            // changes return a position with the ranges we have.
            if (targetY === null) {
                targetY = side === "top" ? rangeRect.bottom : rangeRect.top;
            } else if (side === "top" ? targetY <= rangeRect.top : targetY >= rangeRect.bottom) {
                // HACK(calebmer): Using `secondBestPosition` is a hack. To explain why we
                // sometimes use `secondBestPosition` let's start by saying you have the following
                // text:
                //
                // ```
                // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                // ```
                //
                // All the character "x" and importantly, no spaces! Now let's say this is wrapped
                // onto multiple lines like this:
                //
                // ```
                // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                // xxxxxxxxxxxxxxxx
                // ```
                //
                // We have 60 "x" characters and then wrap the rest of the "x" characters onto a
                // new line. In text editors, if the caret is at position 60 that could actually
                // render in one of two places!
                //
                // Option 1 (caret is visualized with `|`):
                //
                // ```
                // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|
                // xxxxxxxxxxxxxxxx
                // ```
                //
                // Option 2:
                //
                // ```
                // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                // |xxxxxxxxxxxxxxxx
                // ```
                //
                // I've heard this called the caret's "affinity" though I can't remember where I
                // heard this.
                //
                // When you tell the browser to put the caret at position 60 it's arbitrary which
                // option the browser will choose. For the purposes of this function, option 2
                // would be very confusing. Since instead of navigating to the end of the first
                // line when the user presses the down arrow key they'll instead be navigating to
                // the start of the second line!
                //
                // To avoid this situation, if the last position in the line is also the best
                // position then we'll instead use the second best position so we put the caret
                // here which is unambiguous so the browser won't put it in a weird place:
                //
                // ```
                // xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|x
                // xxxxxxxxxxxxxxxx
                // ```
                //
                // NOTE(calebmer, #canvas-text-editor): This is a reason we should build our own
                // `<canvas>` text editor. Browsers like Chrome have a [`TextAffinity`][1] property
                // on their internal [selection data structure][2] which controls whether the
                // selection is at the start of the next line or end of the previous line. However,
                // this affinity isn't readable in JavaScript and isn't writable by JavaScript. So
                // we should build our own text editor completely in JavaScript.
                //
                // [1]:
                //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/text_affinity.h#L34
                // [2]:
                //     https://github.com/chromium/chromium/blob/d56ca9dbdd83b443cef3e363abbfaf2cbe969e1b/third_party/blink/renderer/core/editing/selection_template.h#L143
                if (isLastPositionBest) {
                    return secondBestPosition ?? bestPosition;
                } else {
                    return bestPosition;
                }
            }

            const distance = Math.abs(rangeX - targetX);
            if (distance < bestDistance) {
                secondBestPosition = bestPosition;
                bestPosition = {node, offset};
                bestDistance = distance;
                isLastPositionBest = true;
            } else {
                isLastPositionBest = false;
            }
        }
    }

    return bestPosition;

    function getNextNode(node: Node): Node | null {
        const childNode = side === "top" ? node.firstChild : node.lastChild;
        if (childNode !== null) return childNode;

        for (
            let currentNode: Node | null = node;
            currentNode !== null;
            currentNode = currentNode.parentNode
        ) {
            if (currentNode === element) return null;

            const siblingNode =
                side === "top" ? currentNode.nextSibling : currentNode.previousSibling;
            if (siblingNode !== null) return siblingNode;
        }

        return null;
    }
}
