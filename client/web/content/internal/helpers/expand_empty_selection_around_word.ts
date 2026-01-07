import {Node} from "prosemirror-model";
import {Selection, TextSelection} from "prosemirror-state";
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";

/**
 * If the selection is empty and inside a word then return a selection that
 * covers that word. If the selection is at the edge of a word or already
 * covers some content, return null.
 */
export function expandEmptySelectionAroundWord(
    doc: Node,
    selection: Selection,
): TextSelection | null {
    if (selection.from !== selection.to) return null;

    const nodeBefore = selection.$from.nodeBefore;
    if (nodeBefore && !nodeBefore.isText) return null;

    const nodeAfter = selection.$from.nodeAfter;
    if (nodeAfter && !nodeAfter.isText) return null;

    const textBefore = nodeBefore
        ? (iterableFirst(
              Array.from(findUnicodeDefaultWordBoundarySpans(nodeBefore.text!)).reverse(),
          )?.text ?? "")
        : "";
    const textAfter = nodeAfter
        ? (iterableFirst(findUnicodeDefaultWordBoundarySpans(nodeAfter.text!))?.text ?? "")
        : "";

    const textAround = textBefore + textAfter;
    if (textAround.length <= 2) return null;

    const textAroundSpans = Array.from(findUnicodeDefaultWordBoundarySpans(textAround));
    const textAroundSpan =
        textAroundSpans.length === 1
            ? textAroundSpans[0]!
            : textAroundSpans.length === 2
              ? textAroundSpans[0]!.length > textAroundSpans[1]!.length
                  ? textAroundSpans[0]!
                  : textAroundSpans[1]!
              : null;
    if (!textAroundSpan) return null;

    return new TextSelection(
        doc.resolve(
            selection.from -
                (textAroundSpan.length === textAround.length ||
                textAroundSpan.length === textBefore.length
                    ? textBefore.length
                    : 0),
        ),
        doc.resolve(
            selection.from +
                (textAroundSpan.length === textAround.length ||
                textAroundSpan.length === textAfter.length
                    ? textAfter.length
                    : 0),
        ),
    );
}
