/**
 * NOTE(maximchen, 2024-05-14): This is a Typescript port of the
 * functions `defaultBlockAt`, `split`, `splitBlockAs` from Marijn Haverbeke's
 * Prosemirror project.
 *
 * The reason we ported these functions is because we wanted to add custom
 * behavior (i.e adding indentation and whitespace to newly created
 * code block lines) to the splitBlock function. And we want to maintain
 * splitBlock original behavior for other nodes such as paragraph, and listItems.
 *
 * Without forking splitBlock and applying our custom behavior,
 * the code block line would not be able to be split with the
 *  proper whitespace indentation on new code block lines.
 *
 * The MIT License
 *
 * Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import {Attrs, ContentMatch, Fragment, Node, NodeType, Slice} from "prosemirror-model";
import {AllSelection, Command, NodeSelection, TextSelection} from "prosemirror-state";
import {canSplit, ReplaceStep, Transform} from "prosemirror-transform";

function defaultBlockAt(match: ContentMatch) {
    for (let i = 0; i < match.edgeCount; i++) {
        let {type} = match.edge(i);
        if (type.isTextblock && !type.hasRequiredAttrs()) return type;
    }
    return null;
}

function splitWithCodeBlockLineLeadingIdentation(
    tr: Transform,
    pos: number,
    depth = 1,
    typesAfter?: (null | {type: NodeType; attrs?: Attrs | null})[],
) {
    let $pos = tr.doc.resolve(pos),
        before = Fragment.empty,
        after = Fragment.empty;

    // NOTE: This is the code that we modified from the fork.
    // If the node is a code block line, we append to the after fragments.
    // In this case we extract the amount of leading
    // indentation to apply on the new Slice
    const currentNode = $pos.node($pos.depth);
    if (currentNode.type.name === "codeBlockLine") {
        const leadingWhiteSpaceMatch = currentNode.textContent.match(/^ +/);
        const leadingIndentation = leadingWhiteSpaceMatch ? leadingWhiteSpaceMatch[0] : "";

        if (leadingIndentation.length > 0) {
            const textNode = currentNode.type.schema.text(leadingIndentation);
            after = after.addToEnd(textNode);
        }
    }

    for (let d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
        before = Fragment.from($pos.node(d).copy(before));
        let typeAfter = typesAfter && typesAfter[i];
        after = Fragment.from(
            typeAfter ? typeAfter.type.create(typeAfter.attrs, after) : $pos.node(d).copy(after),
        );
    }

    tr.step(new ReplaceStep(pos, pos, new Slice(before.append(after), depth, depth), true));
}

function splitBlockAsWithCodeBlockLineLeadingIndentation(
    splitNode?: (node: Node, atEnd: boolean) => {type: NodeType; attrs?: Attrs} | null,
): Command {
    return (state, dispatch) => {
        let {$from, $to} = state.selection;
        if (state.selection instanceof NodeSelection && state.selection.node.isBlock) {
            if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false;
            if (dispatch) {
                const transaction = state.tr;
                splitWithCodeBlockLineLeadingIdentation(transaction, $from.pos);
                dispatch(transaction.scrollIntoView());
            }
            return true;
        }

        if (!$from.parent.isBlock) return false;

        if (dispatch) {
            let atEnd = $to.parentOffset == $to.parent.content.size;
            let tr = state.tr;
            if (state.selection instanceof TextSelection || state.selection instanceof AllSelection)
                tr.deleteSelection();
            let deflt =
                $from.depth == 0
                    ? null
                    : defaultBlockAt($from.node(-1).contentMatchAt($from.indexAfter(-1)));
            let splitType = splitNode && splitNode($to.parent, atEnd);
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
                splitWithCodeBlockLineLeadingIdentation(tr, tr.mapping.map($from.pos), 1, types);
                if (!atEnd && !$from.parentOffset && $from.parent.type != deflt) {
                    let first = tr.mapping.map($from.before()),
                        $first = tr.doc.resolve(first);
                    if (
                        deflt &&
                        $from.node(-1).canReplaceWith($first.index(), $first.index() + 1, deflt)
                    )
                        tr.setNodeMarkup(tr.mapping.map($from.before()), deflt);
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
