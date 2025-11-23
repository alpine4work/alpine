import {isDisplayBlockLevel} from "~/client/web/helpers/elements/is_node_block_level.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {getSelectionStartNodeAndEndNode} from "~/client/web/helpers/get_selection_start_node_and_end_node.js";
import {writeTextToClipboardFallback} from "~/client/web/helpers/write_text_to_clipboard.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {htmlBlockTagNames} from "~/shared/helpers/html/html_block_tag_names.js";

export type ClipboardSerializer = (selection: {
    startNode: Node;
    startOffset: number;
    endNode: Node;
    endOffset: number;
}) => {
    requiredLineBreakAroundCount?: number;
    text: string;
    html: Node;
};

let clipboardSerializerByNode: WeakMap<Node, ClipboardSerializer> | null = null;

export function registerClipboardSerializer(
    node: Node,
    serialize: ClipboardSerializer,
): () => void {
    clipboardSerializerByNode ??= new WeakMap();
    assert(!clipboardSerializerByNode.has(node));
    clipboardSerializerByNode.set(node, serialize);
    return () => {
        clipboardSerializerByNode?.delete(node);
    };
}

/**
 * We override the `copy` event when the selection is not entirely within a
 * text input element. This allows us to have custom copy behavior for
 * non-editable views. For example, we can use our content clipboard serializer
 * when copying `<ContentView>` to match `<ContentEditor>`.
 *
 * By default we use a similar algorithm to HTML's `innerText` for generating
 * copied content. This drops all CSS styling from copied content. If you want
 * to preserve some HTML styling you must use `registerClipboardSerializer()`.
 *
 * While not implemented yet, we can also use this to make the result of
 * copying content from a post view or messaging view much nicer. For example,
 * by including text like "From Caleb Meredith at 4:00pm" before each message.
 */
export function handleCopyEventIfNotTextInputElement(event: ClipboardEvent) {
    // If focus is in a text input element then we want to let the text input
    // element handle the `copy` event. Or let the browser perform its default copy
    // behavior.
    if (document.activeElement && isTextInputElement(document.activeElement)) {
        return;
    }

    const selection = document.getSelection();
    if (!selection || !selection.anchorNode || !selection.focusNode || selection.isCollapsed) {
        return;
    }

    event.preventDefault();

    const result = getSelectionClipboardData({
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
    });

    if (result) {
        // If there is no `navigator.clipboard` (e.g. in Safari) then write text only
        // with our fallback.
        if (!navigator.clipboard) {
            writeTextToClipboardFallback(result.text);
        } else {
            navigator.clipboard
                .write([
                    new ClipboardItem({
                        "text/html": new Blob([result.html.innerHTML], {type: "text/html"}),
                        "text/plain": new Blob([result.text], {type: "text/plain"}),
                    }),
                ])
                .catch(scheduleUncaughtError);
        }
    }
}

/**
 * Get the data we write to the clipboard for a selection.
 */
export function getSelectionClipboardData(selection: {
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
}): {text: string; html: Element} | null {
    // For the purposes of this algorithm:
    //
    // - `startNode` is inclusive of its child nodes
    // - `endNode` is not inclusive of its child nodes
    const {
        startNode,
        startOffset,
        startParentNodes,
        endNode,
        endOffset,
        endParentNodes,
        commonParentReverseIndex,
    } = getSelectionStartNodeAndEndNode(selection);

    const results: Array<
        string | {requiredLineBreakAroundCount?: number; text: string; html: Node | null} | number
    > = [];

    for (
        let i = startParentNodes.length - commonParentReverseIndex;
        i < startParentNodes.length;
        i++
    ) {
        const commonGrandParentNode = startParentNodes[i]!;

        const clipboardSerializer = clipboardSerializerByNode?.get(commonGrandParentNode);
        if (clipboardSerializer !== undefined) {
            const result = clipboardSerializer({startNode, startOffset, endNode, endOffset});
            results.push(result);
            break;
        }
    }

    // If the selection is entirely within a common grand parent node then we
    // serialized the selection above and so have no more work to do.
    if (results.length === 0) {
        let startNodeWithClipboardSerializer: Node | null = null;
        let endNodeWithClipboardSerializer: Node | null = null;
        let endNodeClipboardSerializer: ClipboardSerializer | null = null;

        for (let i = startParentNodes.length - 1; i >= 0; i--) {
            const startParentNode = startParentNodes[i]!;

            const clipboardSerializer = clipboardSerializerByNode?.get(startParentNode);
            if (clipboardSerializer !== undefined) {
                startNodeWithClipboardSerializer = startParentNode;

                const result = clipboardSerializer({startNode, startOffset, endNode, endOffset});

                results.push(result);

                if (result.requiredLineBreakAroundCount)
                    results.push(result.requiredLineBreakAroundCount);
                break;
            }
        }

        // If there was no clipboard serializer for the start node and we're starting
        // in a text node then add the slice of text we have selected...
        if (!startNodeWithClipboardSerializer && startNode instanceof Text) {
            const parentElement = startNode.parentElement;
            const parentComputedStyle = parentElement ? getComputedStyle(parentElement) : null;

            // Same check as we have in our loop for skipping over hidden elements.
            const isParentElementHidden =
                (parentComputedStyle?.visibility ?? "visible") !== "visible" ||
                // Don't look at client rects in Jest unit tests. JSDOM never lays out elements
                // so the length will always be 0.
                (!import.meta.jest &&
                    parentElement &&
                    parentElement.getClientRects().length === 0) ||
                // Optimization: Skip descending into SVG icon children. Interestingly, `svg`
                // element `tagName`s are not capitalized.
                parentElement?.tagName === "svg";

            if (!isParentElementHidden) {
                results.push(
                    startNode.data.slice(
                        startOffset,
                        startNode === endNode ? endOffset : undefined,
                    ),
                );
            }
        }

        if (endNode !== startNode) {
            for (let i = endParentNodes.length - 1; i >= 0; i--) {
                const endParentNode = endParentNodes[i]!;

                const clipboardSerializer = clipboardSerializerByNode?.get(endParentNode);
                if (clipboardSerializer !== undefined) {
                    endNodeWithClipboardSerializer = endParentNode;
                    endNodeClipboardSerializer = clipboardSerializer;
                    break;
                }
            }
        }

        // For copying we implement a version of the [HTML spec's `innerText`
        // algorithm][1]. This discards all styles from copied content. If a developer
        // wants styles on their element to be preserved when copying then they MUST
        // manually register copy behavior.
        //
        // We copy each step of the algorithm into comments over the code implementing
        // the step. If we modify the `innerText` algorithm then we say so in a NOTE
        // comment.
        //
        // [1]: https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute
        let visited = !!startNodeWithClipboardSerializer;
        let node: Node | null = startNodeWithClipboardSerializer ?? startNode;
        while (node !== null) {
            // We've reached the end node! Stop iterating.
            if (node === endNode || node === endNodeWithClipboardSerializer) break;

            if (visited === false && node instanceof Element) {
                const clipboardSerializer = clipboardSerializerByNode?.get(node);
                if (clipboardSerializer) {
                    visited = true;

                    const result = clipboardSerializer({
                        startNode,
                        startOffset,
                        endNode,
                        endOffset,
                    });

                    if (result.requiredLineBreakAroundCount)
                        results.push(result.requiredLineBreakAroundCount);

                    results.push(result);

                    if (result.requiredLineBreakAroundCount)
                        results.push(result.requiredLineBreakAroundCount);
                } else {
                    const computedStyle = getComputedStyle(node);

                    // 2. If node's computed value of 'visibility' is not 'visible', then return
                    //    items.
                    //
                    // 3. If node is not being rendered, then return items. For the purpose of this
                    //    step, the following elements must act as described if the computed value
                    //    of the 'display' property is not 'none':
                    //
                    //    - `select` elements have an associated non-replaced inline CSS box whose
                    //      child boxes include only those of `optgroup` and `option` element child
                    //      nodes;
                    //
                    //    - `optgroup` elements have an associated non-replaced block-level CSS box
                    //      whose child boxes include only those of `option` element child nodes;
                    //      and
                    //
                    //    - `option` element have an associated non-replaced block-level CSS box
                    //      whose child boxes are as normal for non-replaced block-level CSS boxes.
                    //
                    // NOTE(calebmer): Ignoring the instructions around `<select>`, `<optgroup>`,
                    // and `<option>` for now.
                    if (
                        computedStyle.visibility !== "visible" ||
                        // Don't look at client rects in Jest unit tests. JSDOM never lays out elements
                        // so the length will always be 0.
                        (!import.meta.jest && node.getClientRects().length === 0) ||
                        // Optimization: Skip descending into SVG icon children. Interestingly, `svg`
                        // element `tagName`s are not capitalized.
                        node.tagName === "svg"
                    ) {
                        visited = true;
                    }
                    // NOTE(calebmer): This is an addition of ours that the `innerText` algorithm
                    // doesn't require. Don't include text for nodes that aren't selectable when
                    // copying.
                    //
                    // In Safari `user-select` is behind a vendor prefix.
                    else if (
                        (computedStyle.userSelect || computedStyle.webkitUserSelect) !== "none"
                    ) {
                        // 8. (Part 1.) If node is a `p` element, then append 2 (a required line break
                        //    count) at the beginning and end of items.
                        if (node.tagName === "P") {
                            results.push(2);
                        }
                        // 9. (Part 1.) If node's used value of 'display' is block-level or
                        //    'table-caption', then append 1 (a required line break count) at the
                        //    beginning and end of items.
                        else if (
                            isDisplayBlockLevel(
                                computedStyle.display ||
                                    (htmlBlockTagNames.has(node.tagName.toLowerCase())
                                        ? "block"
                                        : ""),
                            )
                        ) {
                            results.push(1);
                        }
                    }
                }
            }

            // 1. Let items be the result of running the rendered text collection steps
            //    with each child node of node in tree order, and then concatenating the
            //    results to a single list.
            if (visited === false) {
                if (node.firstChild === null) {
                    visited = true;
                } else {
                    visited = false;
                    node = node.firstChild;
                    continue;
                }
            }

            // Fail-safe. If `node` contains `endNode` then we should have stopped the loop
            // while iterating through `node`'s children. However, if we skipped visiting
            // `node`'s children for some reason
            // (e.g. `node.getClientRects().length === 0`) then we'll end the loop at this
            // failsafe.
            if (node.contains(endNode) || node.contains(endNodeWithClipboardSerializer)) {
                break;
            }

            // 4. If node is a `Text` node, then for each CSS text box produced by node, in
            //    content order, compute the text of the box after application of the CSS
            //    'white-space' processing rules and 'text-transform' rules, set items to
            //    the list of the resulting strings, and return items. The CSS
            //    'white-space' processing rules are slightly modified: collapsible spaces
            //    at the end of lines are always collapsed, but they are only removed if
            //    the line is the last line of the block, or it ends with a br element.
            //    Soft hyphens should be preserved.
            //
            // NOTE(calebmer): Ignoring the instructions around `white-space` and
            // `text-transform` processing for now.
            if (node !== startNode && node instanceof Text) {
                const parentComputedStyle = node.parentElement
                    ? getComputedStyle(node.parentElement)
                    : null;

                // NOTE(calebmer): This is an addition of ours that the `innerText` algorithm
                // doesn't require. Don't include text for nodes that aren't selectable when
                // copying.
                //
                // In Safari `user-select` is behind a vendor prefix.
                if (
                    (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                    "none"
                ) {
                    results.push(node.data);
                }
            }

            if (node instanceof Element) {
                const computedStyle = getComputedStyle(node);

                // NOTE(calebmer): This is an addition of ours that the `innerText` algorithm
                // doesn't require. Don't include text for nodes that aren't selectable when
                // copying.
                //
                // In Safari `user-select` is behind a vendor prefix.
                if ((computedStyle.userSelect || computedStyle.webkitUserSelect) !== "none") {
                    // 5. If node is a `br` element, then append a string containing a single
                    //    U+000A LF code point to items.
                    if (node.tagName === "BR") {
                        // NOTE(calebmer): We add special handling for `<br>` elements with
                        // `data-copy="force-newlines"`. We don't add any text for the element, instead
                        // we prevent the newlines around this position from collapsing. Useful for
                        // `<ContentFileCodeViewer>` to make sure code is copied correctly without
                        // needing a custom clipboard serializer.
                        if (node.getAttribute("data-copy") === "force-newlines") {
                            results.push({text: "", html: null});
                        } else {
                            results.push({text: "\n", html: document.createElement("br")});
                        }
                    }

                    // 6. If node's computed value of 'display' is 'table-cell', and node's CSS box
                    //    is not the last 'table-cell' box of its enclosing 'table-row' box, then
                    //    append a string containing a single U+0009 TAB code point to items.
                    //
                    // 7. If node's computed value of 'display' is 'table-row', and node's CSS box
                    //    is not the last 'table-row' box of the nearest ancestor 'table' box, then
                    //    append a string containing a single U+000A LF code point to items.
                    //
                    // NOTE(calebmer): Ignoring these instructions for now. Tables should mostly be
                    // rendered as content which will have its own text serializer.

                    // 8. (Part 2.) If node is a `p` element, then append 2 (a required line break
                    //    count) at the beginning and end of items.
                    if (node.tagName === "P") {
                        results.push(2);
                    }
                    // 9. (Part 2.) If node's used value of 'display' is block-level or
                    //    'table-caption', then append 1 (a required line break count) at the
                    //    beginning and end of items.
                    else if (
                        isDisplayBlockLevel(
                            computedStyle.display ||
                                (htmlBlockTagNames.has(node.tagName.toLowerCase()) ? "block" : ""),
                        )
                    ) {
                        results.push(1);
                    }
                }
            }

            if (node.nextSibling !== null) {
                visited = false;
                node = node.nextSibling;
            } else {
                visited = true;
                node = node.parentNode;
            }
        }

        if (endNodeClipboardSerializer) {
            const result = endNodeClipboardSerializer({startNode, startOffset, endNode, endOffset});

            if (result.requiredLineBreakAroundCount)
                results.push(result.requiredLineBreakAroundCount);

            results.push(result);
        }
        // If there was no clipboard serializer for the end node and we're ending
        // in a text node then add the slice of text we have selected...
        else if (node === endNode && endNode instanceof Text && startNode !== endNode) {
            results.push(endNode.data.slice(0, endOffset));
        }
    }

    let text = "";
    const html = document.createElement("div");

    let lastRequiredLineBreakCount = 0;
    for (const result of results) {
        if (typeof result === "number") {
            lastRequiredLineBreakCount = Math.max(result, lastRequiredLineBreakCount);
            continue;
        }

        // If our HTML starts/ends with an element that itself inserts line breaks
        // (e.g. `<p>` and `<div>`) we shouldn't insert `<br>` elements since the
        // resulting HTML rendered with default CSS styles will have more whitespace
        // than necessary. Given the line breaking elements will create a newline AND
        // `<br>` will create another newline.
        const lastRequiredLineBreakCountForHtml = Math.max(
            0,
            lastRequiredLineBreakCount -
                Math.max(
                    html.lastChild ? getEndLineBreakCount(html.lastChild) : 0,
                    typeof result !== "string" && result.html !== null
                        ? getStartLineBreakCount(result.html)
                        : 0,
                ),
        );

        for (let i = 0; i < lastRequiredLineBreakCount; i++) {
            text += "\n";
        }
        for (let i = 0; i < lastRequiredLineBreakCountForHtml; i++) {
            html.appendChild(document.createElement("br"));
        }
        lastRequiredLineBreakCount = 0;

        if (typeof result === "string") {
            text += result;
            if (result.length > 0) html.appendChild(document.createTextNode(result));
        } else {
            text += result.text;
            if (result.html !== null) html.appendChild(result.html);
        }
    }

    return {text, html};
}

/**
 * Implements a subset of the HTML `innerText` algorithm for determining how
 * many line breaks `innerText` would add at the start of the provided node.
 * Our implementation closely follows `getSelectionClipboardData()` which
 * documents each step of the `innerText` algorithm. Refer to that function for
 * more details about each of the steps in this function.
 */
function getStartLineBreakCount(node: Node): number {
    let lineBreakCount = 0;

    const compute = (node: Node) => {
        if (node instanceof Text) {
            const parentComputedStyle = node.parentElement
                ? getComputedStyle(node.parentElement)
                : null;

            if (
                (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                "none"
            ) {
                return true;
            }
        }

        if (node instanceof Element) {
            const computedStyle = getComputedStyle(node);

            if ((computedStyle.userSelect || computedStyle.webkitUserSelect) !== "none") {
                if (node.tagName === "P") {
                    lineBreakCount = Math.max(2, lineBreakCount);
                } else if (
                    isDisplayBlockLevel(
                        computedStyle.display ||
                            (htmlBlockTagNames.has(node.tagName.toLowerCase()) ? "block" : ""),
                    )
                ) {
                    lineBreakCount = Math.max(1, lineBreakCount);
                }
            }
        }

        if (node.firstChild) if (compute(node.firstChild)) return true;
        if (node.nextSibling) if (compute(node.nextSibling)) return true;
        return false;
    };

    compute(node);

    return lineBreakCount;
}

/**
 * Implements a subset of the HTML `innerText` algorithm for determining how
 * many line breaks `innerText` would add at the end of the provided node.
 * Our implementation closely follows `getSelectionClipboardData()` which
 * documents each step of the `innerText` algorithm. Refer to that function for
 * more details about each of the steps in this function.
 */
function getEndLineBreakCount(node: Node): number {
    let lineBreakCount = 0;

    const compute = (node: Node) => {
        if (node instanceof Text) {
            const parentComputedStyle = node.parentElement
                ? getComputedStyle(node.parentElement)
                : null;

            if (
                (parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !==
                "none"
            ) {
                return true;
            }
        }

        if (node instanceof Element) {
            const computedStyle = getComputedStyle(node);

            if ((computedStyle.userSelect || computedStyle.webkitUserSelect) !== "none") {
                if (node.tagName === "P") {
                    lineBreakCount = Math.max(2, lineBreakCount);
                } else if (
                    isDisplayBlockLevel(
                        computedStyle.display ||
                            (htmlBlockTagNames.has(node.tagName.toLowerCase()) ? "block" : ""),
                    )
                ) {
                    lineBreakCount = Math.max(1, lineBreakCount);
                }
            }
        }

        if (node.lastChild) if (compute(node.lastChild)) return true;
        if (node.previousSibling) if (compute(node.previousSibling)) return true;
        return false;
    };

    compute(node);

    return lineBreakCount;
}
