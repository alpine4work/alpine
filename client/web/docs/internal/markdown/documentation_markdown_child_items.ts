import {
    DocumentationMarkdownChildren,
    flattenDocumentationMarkdownChildren,
} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/**
 * The non-empty child strings of a markdown variant, one per rendered child. Used
 * where each child is a discrete unit, e.g. a list's items or a table row's cells,
 * so the parent can add its own markers. Whitespace-only entries that MDX
 * interleaves between elements are dropped.
 */
export function documentationMarkdownChildItems(
    children: DocumentationMarkdownChildren,
): Array<string> {
    const items = Array.isArray(children) ? children : [children];
    return items
        .map(item => flattenDocumentationMarkdownChildren(item).trim())
        .filter(item => item.length > 0);
}
