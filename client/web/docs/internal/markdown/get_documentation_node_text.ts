import {isValidElement} from "react";

/**
 * The concatenated text content of a React node, walking into element children.
 * Used to derive heading anchor ids and to pull the source out of `<pre><code>`
 * fenced blocks, both of which need the plain text of arbitrary MDX children.
 */
export function getDocumentationNodeText(node: unknown): string {
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(getDocumentationNodeText).join("");
    if (isValidElement(node)) {
        const elementProps: unknown = node.props;
        if (
            typeof elementProps === "object" &&
            elementProps !== null &&
            "children" in elementProps
        ) {
            return getDocumentationNodeText(elementProps.children);
        }
    }
    return "";
}
