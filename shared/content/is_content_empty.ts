import {Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Is the provided content completely empty?
 *
 * If the content has a title node then both the title node and body node need to
 * not be empty.
 */
export function isContentEmpty(node: Node): boolean {
    if (node.type.schema.nodes.title && !isContentTitleEmpty(node)) return false;
    return isContentBodyEmpty(node);
}

/**
 * Is the content title node empty? The title node is only included in
 * `DocumentContent`. If the schema does not have a title node then this always
 * returns false.
 */
export function isContentTitleEmpty(node: Node): boolean {
    assert(node.type.name === "doc");
    if (!node.type.schema.nodes.title) return false;
    const firstChildNode = node.child(0);
    return firstChildNode.type.name === "title" && firstChildNode.content.size === 0;
}

/**
 * Is the content body (excluding the title node) empty? If this is
 * `DocumentContent` with a title node and the title node has some text but the
 * rest of the body is empty then this will return true. Otherwise there needs to
 * be no content.
 */
export function isContentBodyEmpty(node: Node): boolean {
    assert(node.type.name === "doc");

    let bodyChildNode;
    if (!node.type.schema.nodes.title) {
        if (node.childCount !== 1) return false;
        bodyChildNode = node.child(0);
    } else {
        if (node.childCount !== 2) return false;
        bodyChildNode = node.child(1);
    }

    return bodyChildNode.type.name === "paragraph" && bodyChildNode.content.size === 0;
}
