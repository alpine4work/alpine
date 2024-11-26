import {Node} from "prosemirror-model";
import {ContentWithReferences} from "~/shared/content/content_references.js";

/**
 * Trim spaces from the end of a ProseMirror node. We call this before sending
 * a chat message or creating a post. Trailing white space is usually an
 * accident and looks weird in the message.
 */
export function trimContentEnd<Content extends Node>(node: Content): Content {
    return actuallyTrimContentEnd(node) as Content;
}

export function trimContentWithReferencesEnd<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = actuallyTrimContentEnd(content.doc);
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

function actuallyTrimContentEnd(node: Node): Node {
    if (node.content.content.length === 0) return node;

    const oldLastChildNode = node.content.content[node.content.content.length - 1]!;

    if (!oldLastChildNode.isText) {
        const newLastChildNode = actuallyTrimContentEnd(oldLastChildNode);

        // If the last node is an empty paragraph, then remove it and then try trimming
        // the new last node.
        if (newLastChildNode.type.name === "paragraph" && newLastChildNode.content.size === 0) {
            return actuallyTrimContentEnd(
                node.type.create(node.attrs, node.content.content.slice(0, -1)),
            );
        }

        if (oldLastChildNode === newLastChildNode) return node;

        return node.type.create(node.attrs, [
            ...node.content.content.slice(0, -1),
            newLastChildNode,
        ]);
    }

    const trimmedText = oldLastChildNode.text!.trimEnd();
    if (trimmedText.length === oldLastChildNode.text!.length) return node;

    return node.type.create(node.attrs, [
        ...node.content.content.slice(0, -1),
        node.type.schema.text(trimmedText),
    ]);
}
