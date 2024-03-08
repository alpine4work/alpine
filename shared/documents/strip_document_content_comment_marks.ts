import {Node} from "prosemirror-model";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

/**
 * Strip all comment marks from the provided node. You may chose to include
 * some marks by providing a set of `DocumentCommentThreadId`s.
 */
export function stripDocumentContentCommentMarks(
    node: Node,
    options?: {exceptCommentThreadIds?: ReadonlySet<DocumentCommentThreadId>},
): Node {
    const newChildNodes: Array<Node> = [];
    let hasChildNodeChanged = false;

    for (let i = 0; i < node.childCount; i++) {
        const childNode = node.child(i);
        const newChildNode = stripDocumentContentCommentMarks(childNode, options);

        newChildNodes.push(newChildNode);

        hasChildNodeChanged ||= childNode !== newChildNode;
    }

    const newMarks = node.marks.filter(
        mark =>
            mark.type.name !== "comment" ||
            options?.exceptCommentThreadIds?.has(mark.attrs.commentThreadId),
    );

    if (newMarks.length === node.marks.length && !hasChildNodeChanged) return node;

    // `node.type.create()` doesn't work for text nodes.
    if (node.type.isText) {
        return node.type.schema.text(node.text!, newMarks);
    }

    return node.type.create(node.attrs, newChildNodes, newMarks);
}
