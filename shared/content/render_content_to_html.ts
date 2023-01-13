import {Node} from "prosemirror-model";
import {clampListItemIndentation} from "~/shared/content/content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {
    ElementHtmlGenerator,
    renderProsemirrorDomOutputSpec,
    serializeProsemirrorFragmentToHtml,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {docClassName} = contentSchemaStyles;

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 */
export function renderContentToHtml(topNode: Node) {
    const fragmentHtml = renderContentFragmentToHtml(topNode);
    return `<div class="${docClassName}">${fragmentHtml}</div>`;
}

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 *
 * Does not render the wrapping `<div>` for the entire doc. Only the inner
 * content. Generally you want `renderContentToHtml()`. This is useful if you
 * want to add other attributes to the wrapping `<div>`.
 */
export function renderContentFragmentToHtml(topNode: Node) {
    assert(topNode.type.schema.topNodeType === topNode.type);

    const orderedListItemNumberByNode = new Map<Node, number>();

    const computeChildrenOrderedListItemNumbers = (node: Node) => {
        let previousListItemNumberByIndent: Array<number> = [];

        node.content.forEach(childNode => {
            if (childNode.type.name !== "orderedListItem") {
                previousListItemNumberByIndent = [];
                return;
            }

            const indent = clampListItemIndentation(childNode.attrs.indent);

            // If this item's indentation level is higher than the previous item's
            // indentation level, add new counters for the new indentation levels.
            //
            // If this item's indentation level is lower than the previous item's
            // indentation level, clear deeper indentation level counters since those
            // counters are done.
            if (previousListItemNumberByIndent.length < indent + 1) {
                for (let i = previousListItemNumberByIndent.length; i < indent + 1; i++) {
                    previousListItemNumberByIndent.push(0);
                }
            } else if (previousListItemNumberByIndent.length > indent + 1) {
                previousListItemNumberByIndent = previousListItemNumberByIndent.slice(
                    0,
                    indent + 1,
                );
            }

            const previousListItemNumber = previousListItemNumberByIndent[indent]!;
            const listItemNumber = previousListItemNumber + 1;
            previousListItemNumberByIndent[indent] = listItemNumber;

            orderedListItemNumberByNode.set(childNode, listItemNumber);
        });
    };

    return serializeProsemirrorFragmentToHtml(topNode.content, {
        startPos: 1,
        nodeRenderers: {
            orderedListItem: (node, pos) => {
                const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                    node.type.spec.toDOM!(node),
                );
                assert(html instanceof ElementHtmlGenerator);

                let listItemNumber = orderedListItemNumberByNode.get(node);

                // If we do not have the number for this list item, then compute the number for
                // all list items in this node's parent and try checking for the number again.
                // The number must be present.
                if (listItemNumber === undefined) {
                    const $pos = topNode.resolve(pos);
                    assert($pos.parent === node && $pos.parentOffset === 0);

                    const parentNode = $pos.node($pos.depth - 1);
                    computeChildrenOrderedListItemNumbers(parentNode);

                    listItemNumber = orderedListItemNumberByNode.get(node);
                    assert(listItemNumber !== undefined);
                }

                html.setAttribute("data-list-number", listItemNumber);

                return {html, contentHtml};
            },
        },
    });
}
