import {DOMSerializer, Node} from "prosemirror-model";
import {NodeView} from "prosemirror-view";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Opens the link when the node is clicked instead of selecting text. We're
 * optimizing for reading content here over writing.
 */
export function createContentLinkNodeView(node: Node): NodeView {
    const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
        document,
        node.type.spec.toDOM!(node),
    );

    assert(dom instanceof HTMLAnchorElement);

    dom.addEventListener("pointerdown", event => {
        // Don't select the editable text. Instead we want to open the URL.
        event.preventDefault();

        window.open(
            dom.href,
            "_blank",
            // Important security measure. See:
            // https://mathiasbynens.github.io/rel-noopener
            "noopener noreferrer",
        );
    });

    return {
        dom,
        contentDOM: contentDom,
    };
}
