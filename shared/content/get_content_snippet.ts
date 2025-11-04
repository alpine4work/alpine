import {Node, ResolvedPos} from "prosemirror-model";
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {ContentNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.js";

/**
 * Get a snippet of content around the provided position. The snippet should
 * have the same layout as the source content.
 *
 * We use a line count heuristic to figure out how much to cut. We hardcode the
 * maximum number of characters we expect on a line and if we have enough
 * characters to fill up our expected line count then we split there.
 *
 * While we split immediately when we hit our limit at the end of the snippet,
 * we keep some leading content at the beginning of the snippet. Since that
 * leading content might effect the layout of our snippet. For example, a
 * paragraph. If we cut in the middle of a paragraph then the snippet content
 * may be in a different position given the leading text wasn't there.
 *
 * We try to leave the last word in the snippet whole instead of cutting the
 * word in the middle.
 */
export function getContentSnippet(
    resolvedPos: ResolvedPos,
    lines: {linesAbove: number; linesBelow: number} | number,
    {
        maxLineGraphemeCount = defaultMaxLineGraphemeCount,
        ignoreLineBreaks = false,
    }: {
        maxLineGraphemeCount?: number;

        /**
         * Don't consider a node that creates a line break (e.g. `paragraph` or
         * `heading`) to be the end of a line. This is useful if you want to print your
         * content snippet with `printContentSingleLineTextSnippet()`. Since
         * `printContentSingleLineTextSnippet()` will collapse new lines, so you want
         * your snippet to also consider newlines as "collapsed".
         */
        ignoreLineBreaks?: boolean;
    } = {},
): Node {
    const options = {maxLineGraphemeCount, ignoreLineBreaks};

    // So our target number of lines is `1 + linesAroundCount * 2`. We want the
    // line containing `resolvedPos`, `linesAroundCount` lines above, and
    // `linesAroundCount` lines below. However we don't know where proportionally
    // `resolvedPos` falls on its line. If it falls about 25% through the line then
    // we need `linesAroundCount + 0.25` lines of content before `resolvedPos` and
    // we need `linesAroundCount + 0.75` lines of content after `resolvedPos`.
    // Vice-versa if `resolvedPos` falls 75% through the line. So we get an extra
    // line in both directions which gets us enough content.
    const linesAbove = (typeof lines === "number" ? lines : lines.linesAbove) + 1;
    const linesBelow = (typeof lines === "number" ? lines : lines.linesBelow) + 1;

    let from: number | null = null;
    let to: number | null = null;
    let remainingBefore: {readonly lineCount: number; readonly isAtLineBreak: boolean} = {
        lineCount: linesAbove,
        isAtLineBreak: false,
    };
    let remainingAfter: {readonly lineCount: number; readonly isAtLineBreak: boolean} = {
        lineCount: linesBelow,
        isAtLineBreak: false,
    };

    for (let depth = resolvedPos.depth; depth >= 0; depth--) {
        const node = resolvedPos.node(depth);

        if (depth === resolvedPos.depth && node.isTextblock) {
            const textNodeIndex = resolvedPos.index();
            const textNode = node.child(textNodeIndex);
            if (textNode.isText) {
                {
                    const textBefore = textNode.text!.slice(0, resolvedPos.textOffset);

                    remainingBefore = {
                        lineCount: consumeLinesOfText(
                            textBefore,
                            remainingBefore.lineCount,
                            maxLineGraphemeCount,
                        ).remainingLineCount,
                        isAtLineBreak: false,
                    };

                    if (!ignoreLineBreaks && textNodeIndex === 0) {
                        // If the node is line breaking then round remaining lines down since no other
                        // text can go on the line.
                        const nodeType = node.type.name as Exclude<ContentNodeTypeName, "text">;
                        const lineBreakCount = assertExists(lineBreakCountByNodeType[nodeType]);
                        for (let i = 0; i < lineBreakCount; i++) {
                            remainingBefore = {
                                lineCount: remainingBefore.isAtLineBreak
                                    ? remainingBefore.lineCount - 1
                                    : Math.floor(remainingBefore.lineCount),
                                isAtLineBreak: true,
                            };
                        }
                    }

                    // We don't cut leading text both because `consumeLinesOfText()` counts
                    // forwards (so using `remainingLength` to slice could incorrectly split a
                    // grapheme) and because it would break the text's layout.
                    if (remainingBefore.lineCount <= 0) {
                        from = resolvedPos.start(depth);
                    }
                }

                {
                    const textAfter = textNode.text!.slice(resolvedPos.textOffset);

                    const result = consumeLinesOfText(
                        textAfter,
                        remainingAfter.lineCount,
                        maxLineGraphemeCount,
                    );
                    remainingAfter = {
                        lineCount: result.remainingLineCount,
                        isAtLineBreak: false,
                    };

                    if (!ignoreLineBreaks && textNodeIndex === node.childCount - 1) {
                        // If the node is line breaking then round remaining lines down since no other
                        // text can go on the line.
                        const nodeType = node.type.name as Exclude<ContentNodeTypeName, "text">;
                        const lineBreakCount = assertExists(lineBreakCountByNodeType[nodeType]);
                        for (let i = 0; i < lineBreakCount; i++) {
                            remainingAfter = {
                                lineCount: remainingAfter.isAtLineBreak
                                    ? remainingAfter.lineCount - 1
                                    : Math.floor(remainingAfter.lineCount),
                                isAtLineBreak: true,
                            };
                        }
                    }

                    if (remainingAfter.lineCount <= 0) {
                        to = resolvedPos.end(depth) - 1 - result.remainingLength;
                    }
                }
            }
        }

        const nodePos = resolvedPos.start(depth);
        const nodeOffset = resolvedPos.pos - nodePos;

        if (remainingBefore.lineCount > 0) {
            for (const child of iterateChildNodesBefore(node, nodeOffset)) {
                if (!child.isFork) {
                    const [newRemainingBefore, newFrom] = consumeNodeBefore(
                        nodePos + child.offset,
                        child.node,
                        remainingBefore,
                        options,
                    );

                    remainingBefore = newRemainingBefore;

                    if (newFrom !== null) {
                        from = newFrom;
                        break;
                    }
                } else {
                    const branches = child.branches.map(forkedChildren => {
                        let forkedFrom: number | null = null;
                        let forkedRemainingBefore = remainingBefore;

                        for (const forkedChild of forkedChildren) {
                            const [newForkedRemainingBefore, newForkedFrom] = consumeNodeBefore(
                                nodePos + forkedChild.offset,
                                forkedChild.node,
                                forkedRemainingBefore,
                                options,
                            );

                            forkedRemainingBefore = newForkedRemainingBefore;

                            if (newForkedFrom !== null) {
                                forkedFrom = newForkedFrom;
                                break;
                            }
                        }

                        return [forkedRemainingBefore, forkedFrom] as const;
                    });

                    let newFrom: number | null = null;
                    let isFirstBranch = true;
                    let isNewFromFromFirstBranch = false;
                    let remainingBeforeLineCount = remainingBefore.lineCount;

                    for (const [forkedRemainingBefore, newForkedFrom] of branches) {
                        // Determine the minimum remaining line count after looking at all
                        // branches.
                        if (forkedRemainingBefore.lineCount < remainingBeforeLineCount) {
                            remainingBeforeLineCount = forkedRemainingBefore.lineCount;
                        }

                        if (newForkedFrom !== null && newFrom === null) {
                            newFrom = newForkedFrom;
                            isNewFromFromFirstBranch = isFirstBranch;
                        }

                        isFirstBranch = false;
                    }

                    remainingBefore = {
                        lineCount: remainingBeforeLineCount,
                        isAtLineBreak: true,
                    };

                    // If `newFrom` isn't from the first branch then we end the selection at the
                    // start of the `tableRow` node. Since we can't cut out cells from a table row.
                    //
                    // TODO(calebmer): This is suboptimal since we'll include ENTIRE cells before
                    // the last cell. An optimal solution:
                    //
                    // - Would snip cells individually as individual cells grow too long
                    //
                    // - Would empty out cells after the first ~10 or so since those cells will be
                    //   offscreen when rendering a content snippet (we still need empty
                    //   `tableCell`s to maintain layout but we don't need their content)
                    //
                    // - Would account for table columns being skinner than the block width and
                    //   would lower `maxLineGraphemeCount`
                    //
                    // However, making these optimizations would require a big refactor to
                    // `getContentSnippet()`. For now, we're keeping the basic structure which only
                    // cuts content between a `from` and `to` range. This solution will work fine
                    // for most small tables but may lead to much larger snippets than expected for
                    // large tables.
                    if (newFrom !== null) {
                        if (isNewFromFromFirstBranch) {
                            from = newFrom;
                        } else {
                            from = nodePos + child.offset;
                        }
                        break;
                    }
                }
            }
        }

        if (remainingAfter.lineCount > 0) {
            for (const child of iterateChildNodesAfter(node, nodeOffset)) {
                if (!child.isFork) {
                    const [newRemainingAfter, newTo] = consumeNodeAfter(
                        nodePos + child.offset,
                        child.node,
                        remainingAfter,
                        options,
                    );

                    remainingAfter = newRemainingAfter;

                    if (newTo !== null) {
                        to = newTo;
                        break;
                    }
                } else {
                    const branches = child.branches.map(forkedChildren => {
                        let forkedTo: number | null = null;
                        let forkedRemainingAfter = remainingAfter;

                        for (const forkedChild of forkedChildren) {
                            const [newForkedRemainingAfter, newForkedTo] = consumeNodeAfter(
                                nodePos + forkedChild.offset,
                                forkedChild.node,
                                forkedRemainingAfter,
                                options,
                            );

                            forkedRemainingAfter = newForkedRemainingAfter;

                            if (newForkedTo !== null) {
                                forkedTo = newForkedTo;
                                break;
                            }
                        }

                        return [forkedRemainingAfter, forkedTo] as const;
                    });

                    let newTo: number | null = null;
                    let isNewToFromLastBranch = false;
                    let remainingAfterLineCount = remainingAfter.lineCount;

                    for (const [forkedRemainingAfter, newForkedTo] of branches) {
                        // Determine the minimum remaining line count after looking at all
                        // branches.
                        if (forkedRemainingAfter.lineCount < remainingAfterLineCount) {
                            remainingAfterLineCount = forkedRemainingAfter.lineCount;
                        }

                        if (newForkedTo !== null) {
                            newTo = newForkedTo;
                            isNewToFromLastBranch = true;
                        } else {
                            isNewToFromLastBranch = false;
                        }
                    }

                    remainingAfter = {
                        lineCount: remainingAfterLineCount,
                        isAtLineBreak: true,
                    };

                    // If `newTo` isn't from the last branch then we end the selection at the end
                    // of the `tableRow` node. Since we can't cut out cells from a table row.
                    //
                    // TODO(calebmer): This is suboptimal since we'll include ENTIRE cells before
                    // the last cell. An optimal solution:
                    //
                    // - Would snip cells individually as individual cells grow too long
                    //
                    // - Would empty out cells after the first ~10 or so since those cells will be
                    //   offscreen when rendering a content snippet (we still need empty
                    //   `tableCell`s to maintain layout but we don't need their content)
                    //
                    // - Would account for table columns being skinner than the block width and
                    //   would lower `maxLineGraphemeCount`
                    //
                    // However, making these optimizations would require a big refactor to
                    // `getContentSnippet()`. For now, we're keeping the basic structure which only
                    // cuts content between a `from` and `to` range. This solution will work fine
                    // for most small tables but may lead to much larger snippets than expected for
                    // large tables.
                    if (newTo !== null) {
                        if (isNewToFromLastBranch) {
                            to = newTo;
                        } else {
                            to = nodePos + child.offset + child.node.nodeSize;
                        }
                        break;
                    }
                }
            }
        }
    }

    if (from === null) from = 0;
    if (to === null) to = resolvedPos.doc.nodeSize - 2;

    // Go through the parentage of `from` and if we hit a node where we shouldn't
    // cut out leading children move the `from` position back.
    const resolvedFrom = resolvedPos.doc.resolve(from);
    for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
        const node = resolvedFrom.node(depth);
        const nodeType = node.type.name as Exclude<ContentNodeTypeName, "text">;
        if (assertExists(dontCutLeadingChildrenByNodeType[nodeType])) {
            from = resolvedFrom.start(depth);
        }
    }

    const resolvedTo = resolvedPos.doc.resolve(to);
    if (resolvedTo.textOffset !== 0) {
        const textNode = resolvedTo.parent.maybeChild(resolvedTo.index())!;
        const text = textNode.text!;
        let textIndex = resolvedTo.pos - resolvedTo.start();

        for (let i = resolvedTo.index() - 1; i >= 0; i--) {
            textIndex -= resolvedTo.parent.child(i).nodeSize;
        }

        // Trim any whitespace our snippet ends with.
        if (/\p{White_Space}/u.test(text[textIndex - 1]!)) {
            let newTextIndex = textIndex;

            while (newTextIndex - 1 > 0 && /\p{White_Space}/u.test(text[newTextIndex - 1]!)) {
                newTextIndex -= 1;
            }

            to -= textIndex - newTextIndex;
        }
        // Expand our snippet to the nearest word boundary if the nearest word boundary
        // is less than 14 characters away. According to Claude, 99% of English words
        // are 14 characters or shorter.
        else {
            let newTextIndex = 0;

            for (const span of findUnicodeDefaultWordBoundarySpans(text)) {
                newTextIndex += span.length;
                if (newTextIndex >= textIndex) break;
            }

            if (newTextIndex - textIndex <= maxReasonableEnglishWordGraphemeCount) {
                to += newTextIndex - textIndex;
            }
        }
    }

    return resolvedPos.doc.cut(from, to);
}

type IterateChildNodesValue =
    | {
          isFork: false;
          node: Node;
          offset: number;
      }
    | {
          isFork: true;
          node: Node;
          offset: number;
          branches: Array<Iterable<{node: Node; offset: number}>>;
      };

function* iterateChildNodesAfter(
    node: Node,
    afterOffset: number,
): Iterable<IterateChildNodesValue> {
    const childResult = node.childAfter(afterOffset);
    if (!childResult.node) return;

    let offset = childResult.offset;

    if (childResult.offset >= afterOffset) {
        yield* iterateChildNodesAfterDescendants(childResult.node, offset);
    }

    offset += childResult.node.nodeSize;

    for (let i = childResult.index + 1; i < node.childCount; i++) {
        const childNode = node.child(i);
        yield* iterateChildNodesAfterDescendants(childNode, offset);
        offset += childNode.nodeSize;
    }
}

function* iterateChildNodesAfterDescendants(
    node: Node,
    offset: number,
): Iterable<IterateChildNodesValue> {
    // Table rows "fork" their children. While generating a snippet we need to
    // consider each branch of the fork individually.
    if (node.type.name === "tableRow") {
        yield {
            isFork: true,
            node,
            offset,
            branches: node.content.content.map(tableCellNode => {
                const iterable = concatIterables(
                    mapIterable(iterateChildNodesAfterDescendants(tableCellNode, offset), item => {
                        // There won't be any recursive `tableRow`s.
                        assert(!item.isFork);
                        return item;
                    }),
                    [{isFork: false, node: tableCellNode, offset}],
                );

                offset += tableCellNode.nodeSize;

                return iterable;
            }),
        };
        return;
    }

    const initialOffset = offset;
    offset += 1;

    for (let i = 0; i < node.childCount; i++) {
        const childNode = node.child(i);
        yield* iterateChildNodesAfterDescendants(childNode, offset);
        offset += childNode.nodeSize;
    }

    yield {isFork: false, node, offset: initialOffset};
}

function* iterateChildNodesBefore(
    node: Node,
    beforeOffset: number,
): Iterable<IterateChildNodesValue> {
    const childResult = node.childBefore(beforeOffset);
    if (!childResult.node) return;

    let offset = childResult.offset;

    if (childResult.offset + childResult.node.nodeSize <= beforeOffset) {
        yield* iterateChildNodesBackwardsDescendants(childResult.node, offset);
    }

    for (let i = childResult.index - 1; i >= 0; i--) {
        const childNode = node.child(i);
        offset -= childNode.nodeSize;
        yield* iterateChildNodesBackwardsDescendants(childNode, offset);
    }
}

function* iterateChildNodesBackwardsDescendants(
    node: Node,
    offset: number,
): Iterable<IterateChildNodesValue> {
    // Table rows "fork" their children. While generating a snippet we need to
    // consider each branch of the fork individually.
    if (node.type.name === "tableRow") {
        yield {
            isFork: true,
            node,
            offset,
            branches: node.content.content.map(tableCellNode => {
                const iterable = concatIterables(
                    mapIterable(
                        iterateChildNodesBackwardsDescendants(tableCellNode, offset),
                        item => {
                            // There won't be any recursive `tableRow`s.
                            assert(!item.isFork);
                            return item;
                        },
                    ),
                    [{isFork: false, node: tableCellNode, offset}],
                );

                offset += tableCellNode.nodeSize;

                return iterable;
            }),
        };
        return;
    }

    const initialOffset = offset;
    offset += node.nodeSize;

    for (let i = node.childCount - 1; i >= 0; i--) {
        const childNode = node.child(i);
        offset -= childNode.nodeSize;
        yield* iterateChildNodesBackwardsDescendants(childNode, offset);
    }

    yield {isFork: false, node, offset: initialOffset};
}

/**
 * The number of [graphemes][1] (aka characters) for us to consider one line of
 * text for the purpose of generating snippets. If text has more graphemes than
 * this number it definitely will render to at least one line.
 *
 * Uses graphemes instead of string `length` to accurately handle Unicode
 * characters made out of multiple JavaScript characters and to ignore
 * zero-width characters.
 *
 * We get this number by typing "l", the narrowest character, in a document
 * until text wraps. The number of "l"s in a line is the number we use here.
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
let defaultMaxLineGraphemeCount = 197;

/**
 * Allow Jest tests to modify the `defaultMaxLineGraphemeCount` constant.
 */
export function setDefaultMaxLineGraphemeCountForTest(newDefaultMaxLineGraphemeCount: number) {
    assert(import.meta.jest);
    defaultMaxLineGraphemeCount = newDefaultMaxLineGraphemeCount;
}

/**
 * Does the provided text have enough lines to fill the desired line count? If
 * not we return how many lines we still need to meet our desired line count.
 */
function consumeLinesOfText(
    text: string,
    remainingLineCount: number,
    maxLineGraphemeCount: number,
): {remainingLineCount: number; remainingLength: number} {
    let length = 0;
    let graphemeCount = 0;
    const maxGraphemeCount = maxLineGraphemeCount * remainingLineCount;

    for (const grapheme of iterateGraphemes(text)) {
        length += grapheme.length;
        graphemeCount++;

        if (graphemeCount >= maxGraphemeCount) {
            return {remainingLineCount: 0, remainingLength: text.length - length};
        }
    }

    return {
        remainingLineCount: (maxGraphemeCount - graphemeCount) / maxLineGraphemeCount,
        remainingLength: 0,
    };
}

/**
 * Take a `node` and consume line count from `remainingBefore` that's occupied by the
 * `node`. If this is a `text` node then we estimate the number of lines the text is
 * rendered on and subtract that from the remaining line count. If `node` is not a text
 * node then we check if it creates a line break and if it does, we consume a whole line
 * for each line break.
 *
 * If we've consumed all lines then we'll return `from` which is the start position of
 * our snippet.
 */
// NOTE(calebmer): This isn't a well thought out abstraction. When introducing tables I
// needed to factor out this code so we could run it for each table cell independently. I
// feel like `getContentSnippet()` could use a rewrite at some point to improve code
// quality, fix bugs, and have more predictable outputs.
function consumeNodeBefore(
    pos: number,
    node: Node,
    remainingBefore: {lineCount: number; isAtLineBreak: boolean},
    {
        maxLineGraphemeCount,
        ignoreLineBreaks,
    }: {
        maxLineGraphemeCount: number;
        ignoreLineBreaks: boolean;
    },
): [remainingBefore: {lineCount: number; isAtLineBreak: boolean}, from: number | null] {
    if (node.isText) {
        remainingBefore = {
            lineCount: consumeLinesOfText(
                node.text!,
                remainingBefore.lineCount,
                maxLineGraphemeCount,
            ).remainingLineCount,
            isAtLineBreak: false,
        };

        // We don't cut leading text both because `consumeLinesOfText()` counts
        // forwards (so using `remainingLength` to slice could incorrectly split a
        // grapheme) and because it would break the text's layout.
        if (remainingBefore.lineCount <= 0) {
            const from = pos;
            return [remainingBefore, from];
        }
    } else if (!ignoreLineBreaks) {
        // If the node is line breaking then round remaining lines down since no other
        // text can go on the line.
        const nodeType = node.type.name as Exclude<ContentNodeTypeName, "text">;
        const lineBreakCount = assertExists(lineBreakCountByNodeType[nodeType]);
        for (let i = 0; i < lineBreakCount; i++) {
            remainingBefore = {
                lineCount: remainingBefore.isAtLineBreak
                    ? remainingBefore.lineCount - 1
                    : Math.floor(remainingBefore.lineCount),
                isAtLineBreak: true,
            };
        }

        if (remainingBefore.lineCount <= 0) {
            const from = pos;
            return [remainingBefore, from];
        }
    }

    return [remainingBefore, null];
}

/**
 * Take a `node` and consume line count from `remainingAfter` that's occupied by the
 * `node`. If this is a `text` node then we estimate the number of lines the text is
 * rendered on and subtract that from the remaining line count. If `node` is not a text
 * node then we check if it creates a line break and if it does, we consume a whole line
 * for each line break.
 *
 * If we've consumed all lines then we'll return `to` which is the end position of
 * our snippet.
 */
// NOTE(calebmer): This isn't a well thought out abstraction. When introducing tables I
// needed to factor out this code so we could run it for each table cell independently. I
// feel like `getContentSnippet()` could use a rewrite at some point to improve code
// quality, fix bugs, and have more predictable outputs.
function consumeNodeAfter(
    pos: number,
    node: Node,
    remainingAfter: {lineCount: number; isAtLineBreak: boolean},
    {
        maxLineGraphemeCount,
        ignoreLineBreaks,
    }: {
        maxLineGraphemeCount: number;
        ignoreLineBreaks: boolean;
    },
): [remainingAfter: {lineCount: number; isAtLineBreak: boolean}, to: number | null] {
    if (node.isText) {
        const result = consumeLinesOfText(
            node.text!,
            remainingAfter.lineCount,
            maxLineGraphemeCount,
        );

        remainingAfter = {
            lineCount: result.remainingLineCount,
            isAtLineBreak: false,
        };

        if (remainingAfter.lineCount <= 0) {
            const to = pos + node.nodeSize - 1 - result.remainingLength;
            return [remainingAfter, to];
        }
    } else if (!ignoreLineBreaks) {
        // If the node is line breaking then round remaining lines down since no other
        // text can go on the line.
        const nodeType = node.type.name as Exclude<ContentNodeTypeName, "text">;
        const lineBreakCount = assertExists(lineBreakCountByNodeType[nodeType]);
        for (let i = 0; i < lineBreakCount; i++) {
            remainingAfter = {
                lineCount: remainingAfter.isAtLineBreak
                    ? remainingAfter.lineCount - 1
                    : Math.floor(remainingAfter.lineCount),
                isAtLineBreak: true,
            };
        }

        if (remainingAfter.lineCount <= 0) {
            const to = pos + node.nodeSize;
            return [remainingAfter, to];
        }
    }

    return [remainingAfter, null];
}

/**
 * Does the provided node cause a line break? If it does then we can consider
 * that when computing how many lines remain around the text we're trying
 * to snip.
 *
 * Basically boils down to true if the node is styled with `display: block` and
 * false if the node is styled with `display: inline`.
 *
 * 1: The node type causes a line break.
 * This is typical for block-level elements, which naturally start on a new line.
 *
 * 0: The node type does not cause a line break.
 * This is typical for inline elements, which flow within the same line.
 */
const lineBreakCountByNodeType: {
    [Key in Exclude<ContentNodeTypeName, "text">]: number;
} = {
    // `display: block`
    doc: 1,
    title: 1,
    paragraph: 1,
    quoteBlock: 1,
    codeBlock: 1,
    codeBlockLine: 1,
    unorderedListItem: 1,
    orderedListItem: 1,
    checkListItem: 1,
    break: 1,
    heading: 1,
    divider: 1,
    fileRow: 8,
    fileRowTable: 1,
    // `display: inline`
    mention: 0,
    // Horizontal layout in a `display: flex` or `display: grid` element
    file: 0,
    // Set as `float: left` and `float: right`. Multiple adjacent `fileFloat`s
    // should not be counted as lines for the purpose of snippet cutting
    fileFloat: 0,

    // A table itself doesn't inherently cause a line break because it's a
    // container for rows, which handle the line breaks.
    table: 0,
    // A table row is treated as a block element, so it causes a line break.
    tableRow: 1,
    // A table cell and header are treated as inline elements, so they do
    // not cause a line break.
    tableCell: 0,
};

/**
 * When cutting out a snippet we want the layout of the snippet to be
 * equivalent to the layout of the original doc.
 *
 * Some nodes if we cut out content at the beginning of the node it will effect
 * the layout of content later in the node. So set to true when you want to
 * avoid cutting the leading content of a node.
 */
const dontCutLeadingChildrenByNodeType: {
    [Key in Exclude<ContentNodeTypeName, "text">]: boolean;
} = {
    doc: false,
    title: true,
    // Don't cut text nodes at the start of the paragraph because it will shift
    // the layout of content later in the paragraph.
    paragraph: true,
    // Quote blocks can be cut wherever.
    quoteBlock: false,
    // Can't cut inside a `codeBlockLine` but free to cut any lines above the
    // current line.
    codeBlock: false,
    codeBlockLine: true,
    // In multi-paragraph list items don't cut preceding paragraphs or else the
    // bullet will move to an unexpected place.
    unorderedListItem: true,
    orderedListItem: true,
    checkListItem: true,
    // Don't cut files within a file row since this will adjust the layout of the
    // remaining files in the row.
    fileRow: true,
    fileFloat: true,
    fileRowTable: true,
    file: true,
    // The answer for nodes without children doesn't really matter since we won't
    // cut within them anyways.
    break: true,
    mention: true,
    heading: true,
    divider: true,
    // It's okay to cut the leading children of a table because the table's
    // structure is defined by its rows, not its position in the document.
    table: false,
    // Avoid cutting the leading children of a table row to maintain the structure
    // of the table.
    tableRow: true,
    // It's okay to cut the leading content within a table cell and table header.
    // The reason is that cutting content inside a cell doesn't disrupt the overall
    // table structure. Each cell is independent in terms of layout, so removing
    // content from the start of a cell doesn't affect the alignment or
    // structure of the table as a whole.
    //
    // One more reason to `false` on tableCell is that the content
    // these are nothing but tableBlock which we already handle above
    tableCell: false,
};
