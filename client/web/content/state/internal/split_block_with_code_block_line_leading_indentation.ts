/**
 * NOTE(maximchen, 2024-05-14): This is a Typescript port of the functions
 * `defaultBlockAt`, `split`, `splitBlockAs` from Marijn Haverbeke's Prosemirror
 * project.
 *
 * The reason we ported these functions is because we wanted to add custom behavior
 * (i.e adding indentation and whitespace to newly created code block lines) to the
 * splitBlock function. And we want to maintain splitBlock original behavior for
 * other nodes such as paragraph, and listItems.
 *
 * Without forking splitBlock and applying our custom behavior, the code block line
 * would not be able to be split with the proper whitespace indentation on new code
 * block lines.
 *
 * The MIT License
 *
 * Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {Attrs, ContentMatch, Fragment, Node, NodeType, ResolvedPos, Slice} from "prosemirror-model";
import {AllSelection, Command, NodeSelection, TextSelection, Transaction} from "prosemirror-state";
import {ReplaceStep, canSplit} from "prosemirror-transform";
import {getContentCodeBlockLineAdjacentIndentationSpaceCount} from "~/client/web/content/state/internal/get_content_code_block_line_adjacent_indentation_space_count.js";
import {contentCodeBlockIndentationSpaceCount} from "~/shared/content/content_schema.js";

function defaultBlockAt(match: ContentMatch) {
    for (let i = 0; i < match.edgeCount; i++) {
        const {type} = match.edge(i);
        if (type.isTextblock && !type.hasRequiredAttrs()) return type;
    }
    return null;
}

// NOTE: This is the code we added that's not in the forked code. If the node is a
// code block line, we append to the after fragments. In this case we extract the
// amount of leading indentation to apply on the new Slice
function addCodeBlockLineLeadingIndentation(
    $pos: ResolvedPos,
    node: Node,
    after: Fragment,
): [after: Fragment, afterSelection: Fragment | null] {
    let iterationPos = $pos.start($pos.depth);
    let indentationSpaceCount = 0;
    let hasIndentationEnded = false;
    const openCountByBracket = {"(": 0, "{": 0, "[": 0};
    const wouldNextCharacterCloseByBracket = {"(": false, "{": false, "[": false};

    // Calculate up until `pos`:
    //
    // 1. Leading indentation space count
    // 2. Open bracket count, if we have unbalanced brackets we need to use the next
    //    line's leading indentation
    let childNodeIndex = 0;
    while (childNodeIndex < node.childCount) {
        const childNode = node.child(childNodeIndex);
        childNodeIndex++;
        if (!childNode.isText) {
            iterationPos += childNode.nodeSize;
            hasIndentationEnded = true;
            if (iterationPos >= $pos.pos) break;
            continue;
        }

        const childNodeText = childNode.text!;

        for (let index = 0; index < childNodeText.length; index++) {
            const character = childNodeText[index]!;

            if (!hasIndentationEnded) {
                if (character === " ") {
                    indentationSpaceCount++;
                } else {
                    hasIndentationEnded = true;
                }
            }

            switch (character) {
                case "(":
                    openCountByBracket["("]++;
                    break;
                case ")":
                    if (openCountByBracket["("] > 0) openCountByBracket["("]--;
                    break;
                case "{":
                    openCountByBracket["{"]++;
                    break;
                case "}":
                    if (openCountByBracket["{"] > 0) openCountByBracket["{"]--;
                    break;
                case "[":
                    openCountByBracket["["]++;
                    break;
                case "]":
                    if (openCountByBracket["["] > 0) openCountByBracket["["]--;
                    break;
            }

            iterationPos++;

            if (iterationPos >= $pos.pos) {
                if (index + 1 < childNodeText.length) {
                    const nextCharacter = childNodeText[index + 1]!;

                    switch (nextCharacter) {
                        case ")":
                            wouldNextCharacterCloseByBracket["("] = true;
                            break;
                        case "}":
                            wouldNextCharacterCloseByBracket["{"] = true;
                            break;
                        case "]":
                            wouldNextCharacterCloseByBracket["["] = true;
                            break;
                    }
                }
                break;
            }
        }
    }

    const isSomeBracketOpen =
        openCountByBracket["("] > 0 || openCountByBracket["{"] > 0 || openCountByBracket["["] > 0;

    const originalIndentationSpaceCount = indentationSpaceCount;

    if (!isSomeBracketOpen) {
        // If the line is only indentation, then use an adjacent indentation space count.
        if (!hasIndentationEnded) {
            indentationSpaceCount = Math.max(
                indentationSpaceCount,
                getContentCodeBlockLineAdjacentIndentationSpaceCount($pos),
            );
        }
    }
    // If a bracket is open on this code block line, then let's use the indentation
    // from the _next_ code block line, not this one.
    else {
        const parentNode = $pos.node($pos.depth - 1);
        const parentNodeIndex = $pos.index($pos.depth - 1);

        let nextIndentationSpaceCount = 0;

        if (parentNodeIndex + 1 < parentNode.childCount) {
            const nextNode = parentNode.child(parentNodeIndex + 1);

            let nextChildNodeIndex = 0;
            while (nextChildNodeIndex < nextNode.childCount) {
                const nextChildNode = nextNode.child(nextChildNodeIndex);
                nextChildNodeIndex++;
                if (!nextChildNode.isText) break;

                const nextChildNodeText = nextChildNode.text!;

                for (let i = 0; i < nextChildNodeText.length; i++) {
                    if (nextChildNodeText[i]! === " ") {
                        nextIndentationSpaceCount++;
                    } else {
                        break;
                    }
                }
            }
        }

        if (nextIndentationSpaceCount > indentationSpaceCount) {
            indentationSpaceCount = nextIndentationSpaceCount;
        } else {
            indentationSpaceCount += contentCodeBlockIndentationSpaceCount;
        }
    }

    if (indentationSpaceCount > 0) {
        const indentationTextNode = node.type.schema.text(" ".repeat(indentationSpaceCount));
        after = after.addToEnd(indentationTextNode);
    }

    let afterSelection: Fragment | null = null;
    if (
        (openCountByBracket["("] > 0 && wouldNextCharacterCloseByBracket["("]) ||
        (openCountByBracket["["] > 0 && wouldNextCharacterCloseByBracket["["]) ||
        (openCountByBracket["{"] > 0 && wouldNextCharacterCloseByBracket["{"])
    ) {
        afterSelection = Fragment.empty;
        if (originalIndentationSpaceCount > 0) {
            const indentationTextNode = node.type.schema.text(
                " ".repeat(originalIndentationSpaceCount),
            );
            afterSelection = afterSelection.addToEnd(indentationTextNode);
        }
    }

    return [after, afterSelection];
}

function splitWithCodeBlockLineLeadingIndentation(
    tr: Transaction,
    pos: number,
    depth = 1,
    typesAfter?: Array<null | {type: NodeType; attrs?: Attrs | null}>,
) {
    const $pos = tr.doc.resolve(pos);
    let before = Fragment.empty;
    let after = Fragment.empty;
    let afterSelection: Fragment | null = null;

    // NOTE: This is the code that we modified from the fork. If the node is a code
    // block line, we append to the after fragments. In this case we extract the amount
    // of leading indentation to apply on the new Slice
    const node = $pos.node($pos.depth);
    if (node.type.name === "codeBlockLine") {
        [after, afterSelection] = addCodeBlockLineLeadingIndentation($pos, node, after);
    }

    for (let d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
        before = Fragment.from($pos.node(d).copy(before));
        const typeAfter = typesAfter && typesAfter[i];
        after = Fragment.from(
            typeAfter ? typeAfter.type.create(typeAfter.attrs, after) : $pos.node(d).copy(after),
        );
        afterSelection =
            afterSelection !== null
                ? Fragment.from(
                      typeAfter
                          ? typeAfter.type.create(typeAfter.attrs, afterSelection)
                          : $pos.node(d).copy(afterSelection),
                  )
                : null;
    }

    tr.step(
        new ReplaceStep(
            pos,
            pos,
            new Slice(
                afterSelection !== null
                    ? before.append(after).append(afterSelection)
                    : before.append(after),
                depth,
                depth,
            ),
            true,
        ),
    );

    if (
        afterSelection !== null &&
        tr.selection instanceof TextSelection &&
        tr.selection.from === tr.selection.to
    ) {
        tr.setSelection(new TextSelection(tr.doc.resolve(tr.selection.from - afterSelection.size)));
    }
}

function splitBlockAsWithCodeBlockLineLeadingIndentation(
    splitNode?: (node: Node, atEnd: boolean) => {type: NodeType; attrs?: Attrs} | null,
): Command {
    return (state, dispatch) => {
        const {$from, $to} = state.selection;
        if (state.selection instanceof NodeSelection && state.selection.node.isBlock) {
            if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false;
            if (dispatch) {
                const transaction = state.tr;
                splitWithCodeBlockLineLeadingIndentation(transaction, $from.pos);
                dispatch(transaction.scrollIntoView());
            }
            return true;
        }

        if (!$from.parent.isBlock) return false;

        if (dispatch) {
            const atEnd = $to.parentOffset == $to.parent.content.size;
            const tr = state.tr;
            if (state.selection instanceof TextSelection || state.selection instanceof AllSelection)
                tr.deleteSelection();
            const deflt =
                $from.depth == 0
                    ? null
                    : defaultBlockAt($from.node(-1).contentMatchAt($from.indexAfter(-1)));
            const splitType = splitNode && splitNode($to.parent, atEnd);
            let types = splitType ? [splitType] : atEnd && deflt ? [{type: deflt}] : undefined;
            let can = canSplit(tr.doc, tr.mapping.map($from.pos), 1, types);
            if (
                !types &&
                !can &&
                canSplit(tr.doc, tr.mapping.map($from.pos), 1, deflt ? [{type: deflt}] : undefined)
            ) {
                if (deflt) types = [{type: deflt}];
                can = true;
            }
            if (can) {
                splitWithCodeBlockLineLeadingIndentation(tr, tr.mapping.map($from.pos), 1, types);
                if (!atEnd && !$from.parentOffset && $from.parent.type != deflt) {
                    const first = tr.mapping.map($from.before()),
                        $first = tr.doc.resolve(first);
                    if (
                        deflt &&
                        $from.node(-1).canReplaceWith($first.index(), $first.index() + 1, deflt)
                    ) {
                        tr.setNodeMarkup(tr.mapping.map($from.before()), deflt);
                    }
                }
            }
            dispatch(tr.scrollIntoView());
        }
        return true;
    };
}

/// Split the parent block of the selection. If the selection is a text
/// selection, also delete its content.
export const splitBlockWithCodeBlockLineLeadingIndentation: Command =
    splitBlockAsWithCodeBlockLineLeadingIndentation();
