import {Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Expands a content snippet range so it doesn't start or end in the middle of a
 * text block.
 *
 * This is used by document comment thread snippets when API responses need content
 * keys for the snippet. Those keys encode source document positions, so every
 * keyed paragraph, heading, or code line in the snippet must be a complete copy of
 * the source text block.
 *
 * `getContentSnippetPos()` may cut in the middle of a paragraph, heading, or code
 * line to limit the snippet to a target line count. That's fine for rendering a
 * preview, but a snippet cut mid text block contains a truncated copy of the
 * source block with a different node size, and the cut block's position doesn't
 * map back to the source document by a uniform offset.
 *
 * After this expansion every text block in `doc.cut(from, to)` is a complete copy
 * of the corresponding source block. A position inside the cut content then maps
 * to the source document by adding `from - doc.resolve(from).depth` (re-opened
 * ancestor nodes like quotes or table cells contribute one open token each to the
 * cut content).
 */
export function expandContentSnippetPosToWholeTextBlocks(
    doc: Node,
    {from, to}: {from: number; to: number},
): {from: number; to: number} {
    const resolvedFrom = doc.resolve(from);
    if (resolvedFrom.parent.isTextblock) {
        // If `from` is at the very end of a text block nothing of the block is included,
        // so move past it instead of re-including its content.
        from =
            resolvedFrom.parentOffset === resolvedFrom.parent.content.size
                ? resolvedFrom.after()
                : resolvedFrom.before();
    }

    const resolvedTo = doc.resolve(to);
    if (resolvedTo.parent.isTextblock) {
        // If `to` is at the very start of a text block nothing of the block is included,
        // so move before it instead of including the whole block.
        to = resolvedTo.parentOffset === 0 ? resolvedTo.before() : resolvedTo.after();
    }

    assert(from <= to);
    return {from, to};
}
