import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Opens the link when the node is clicked instead of selecting text. We're
 * optimizing for reading content here over writing.
 */
export function createContentEditorLinkNodeViewConstructor({
    onPreviewShow,
    onPreviewHide,
}: {
    onPreviewShow: (pos: number) => void;
    onPreviewHide: () => void;
}) {
    return (node: Node, view: EditorView, getPos: () => number): NodeView => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(dom instanceof HTMLAnchorElement);

        dom.addEventListener("mousedown", event => {
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

        let isPreviewShowing = false;

        dom.addEventListener("mouseenter", () => {
            if (!isPreviewShowing) {
                isPreviewShowing = true;
                onPreviewShow(getPos());
            }
        });

        dom.addEventListener("mouseleave", () => {
            if (isPreviewShowing) {
                isPreviewShowing = false;
                onPreviewHide();
            }
        });

        return {
            dom,
            contentDOM: contentDom,
            destroy: () => {
                if (isPreviewShowing) {
                    isPreviewShowing = false;
                    onPreviewHide();
                }
            },
        };
    };
}
