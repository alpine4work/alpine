import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {addUnfocusableButtonBehaviorToElement} from "~/client/web/content/state/add_unfocusable_button_behavior_to_element.js";
import {toggleContentEditorHeadingCollapsed} from "~/client/web/content/state/content_editor_heading_collapse_plugin.js";
import {caretRightIconSvg} from "~/client/web/icons/caret_right_icon_svg.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Node view for the content schema's heading node. The heading itself renders
 * exactly like its schema `toDOM` (the content moves into a `<span>` so we have
 * room for sibling chrome), plus an expand chevron in the margin next to the
 * heading. The chevron is only shown when the heading's section is collapsed (the
 * collapse plugin's `data-collapsed` node decoration) and the editor container has
 * `contentStyles.headingSectionControlsClassName`, so collapsed state stays
 * visible and one press away from expanding. Because the chevron lives inside the
 * heading element it inherits the heading's line height and centers itself on the
 * first line of the heading, even when the heading text wraps.
 */
export function createContentEditorHeadingNodeView(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
): NodeView {
    // This DOM structure is defined in content_schema.ts. See heading's toDOM
    // function. It's just the `<h*>` element: we keep it as the outermost element so
    // the sibling selectors between blocks (`title + h2`, `h2 + h3`, ...) keep
    // matching.
    const {dom} = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
    assert(dom instanceof HTMLElement && /^H[1-6]$/.test(dom.tagName));

    const expandButtonContainerElement = document.createElement("div");
    dom.appendChild(expandButtonContainerElement);
    expandButtonContainerElement.contentEditable = "false";
    expandButtonContainerElement.className = contentStyles.headingExpandButtonContainerClassName;

    const expandButtonElement = document.createElement("div");
    expandButtonContainerElement.appendChild(expandButtonElement);
    expandButtonElement.className = contentStyles.headingExpandButtonClassName;
    expandButtonElement.setAttribute("role", "button");
    expandButtonElement.setAttribute("aria-label", "Expand heading");
    expandButtonElement.innerHTML = caretRightIconSvg({
        className: contentStyles.headingExpandButtonIconClassName,
    });

    // We don't need to cleanup event listeners on DOM nodes created for this node
    // view.
    addUnfocusableButtonBehaviorToElement(expandButtonElement, {
        defaultClassName: sprinkles({
            color: "grey-60",
        }),
        hoverClassName: sprinkles({
            color: "grey-60",
            backgroundColor: "grey-5",
        }),
        pressClassName: sprinkles({
            color: "grey-100",
            backgroundColor: "grey-10",
        }),
        onPress: () => {
            toggleContentEditorHeadingCollapsed(view, getPos()!);
        },
    });

    const contentElement = document.createElement("span");
    dom.appendChild(contentElement);
    contentElement.className = contentStyles.headingContentClassName;

    return {
        dom,
        contentDOM: contentElement,
        ignoreMutation: mutation => {
            // Ignore mutations to the chevron (e.g. the unfocusable button behavior toggling
            // classes) so the node isn't recreated when we update it. Selection changes must
            // never be ignored or ProseMirror loses track of the DOM selection.
            if (mutation.type === "selection") return false;
            return !contentElement.contains(mutation.target);
        },
    };
}
