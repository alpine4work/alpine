import {Node} from "prosemirror-model";

export function getContentViewLastParagraphChild(doc: Node): {node: Node; depth: number} | null {
    let node = doc.lastChild;
    let depth = 1;

    while (node !== null) {
        if (node.isTextblock) break;

        // Don't consider a paragraph in a table as the last paragraph child. Since
        // it'll pick the right most table cell which may not make sense in all
        // situations.
        if (node.type.name === "table") break;

        node = node.lastChild;
        depth++;
    }

    return node?.type.name === "paragraph" ? {node, depth} : null;
}
