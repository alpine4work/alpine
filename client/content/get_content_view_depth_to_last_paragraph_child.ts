import {Node} from "prosemirror-model";

export function getContentViewLastParagraphChild(doc: Node): {node: Node; depth: number} | null {
    let node = doc.lastChild;
    let depth = 1;

    while (node !== null) {
        if (node.isTextblock) break;
        node = node.lastChild;
        depth++;
    }

    return node?.type.name === "paragraph" ? {node, depth} : null;
}
