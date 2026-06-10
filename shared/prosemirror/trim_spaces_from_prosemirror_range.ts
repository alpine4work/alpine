import {Node} from "prosemirror-model";

/**
 * Returns the provided range but any space characters at the beginning or end have
 * been removed.
 */
export function trimSpacesFromProsemirrorRange(
    parentNode: Node,
    range: {from: number; to: number},
): {from: number; to: number} {
    let {from, to} = range;
    const $from = parentNode.resolve(range.from);
    const $to = parentNode.resolve(range.to);
    const firstNode = $from.nodeAfter;
    const lastNode = $to.nodeBefore;
    const spaceStart = firstNode && firstNode.isText ? /^\s*/.exec(firstNode.text!)![0].length : 0;
    const spaceEnd = lastNode && lastNode.isText ? /\s*$/.exec(lastNode.text!)![0].length : 0;
    if (from + spaceStart < to) {
        from += spaceStart;
        to -= spaceEnd;
    }
    return {from, to};
}
