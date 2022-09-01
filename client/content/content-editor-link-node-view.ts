import {DOMSerializer, Mark} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {presentExtraContextAfterDelayMs} from "~/client/design/timing-constants";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Opens the link when the node is clicked instead of selecting text. We're
 * optimizing for reading content here over writing.
 */
export function createContentEditorMarkNodeViewConstructor({
    onPointerEnterAfterDelay,
    onPointerEnter,
    onPointerLeave,
}: {
    onPointerEnterAfterDelay: (options: {mark: Mark; range: {from: number; to: number}}) => void;
    onPointerEnter: (mark: Mark) => void;
    onPointerLeave: (mark: Mark) => void;
}): MarkViewConstructor {
    return (mark, view, inline) => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            mark.type.spec.toDOM!(mark, inline),
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

        let pointerEnterDelayTimeoutId: NodeJS.Timeout | null = null;

        dom.addEventListener("pointerenter", event => {
            if (pointerEnterDelayTimeoutId) {
                clearTimeout(pointerEnterDelayTimeoutId);
                pointerEnterDelayTimeoutId = null;
            }

            const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});
            if (!posResult) return;

            const $pos = view.state.doc.resolve(posResult.pos);

            // We do this form instead of `$pos.node()` to find the inline text
            // node the mark is on.
            let index = $pos.index();
            let node = $pos.parent.maybeChild(index);

            // Double check that node has the mark we're rendering.
            if (!node || !mark.isInSet(node.marks)) {
                // If the mark was not present on our node, sometimes that means we found the
                // position of the index after our text node. So try adjusting the index and
                // checking if that node has our mark.
                if (index > 0) {
                    index = index - 1;
                    node = $pos.parent.child(index);
                    if (!mark.isInSet(node.marks)) return;
                } else {
                    return;
                }
            }

            // Find the first node in a sequence to have our mark. In case some text in the
            // middle of the link is bolded.
            while (index > 0) {
                const previousNode = $pos.parent.child(index - 1);
                if (!mark.isInSet(previousNode.marks)) break;
                index = index - 1;
                node = previousNode;
            }

            onPointerEnter(mark);

            pointerEnterDelayTimeoutId = setTimeout(() => {
                onPointerEnterAfterDelay({
                    mark,
                    range: {
                        from: $pos.posAtIndex(index),
                        to: $pos.posAtIndex(index + 1),
                    },
                });
            }, presentExtraContextAfterDelayMs);
        });

        dom.addEventListener("pointerleave", () => {
            if (pointerEnterDelayTimeoutId) {
                clearTimeout(pointerEnterDelayTimeoutId);
                pointerEnterDelayTimeoutId = null;
            }

            onPointerLeave(mark);
        });

        return {
            dom,
            contentDOM: contentDom,
        };
    };
}
