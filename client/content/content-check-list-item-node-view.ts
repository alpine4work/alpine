import {Check} from "phosphor-react";
import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {
    checkListItemCheckboxClassName,
    checkListItemCheckboxHitAreaClassName,
    checkListItemCheckboxPressedClassName,
    checkListItemContentClassName,
} from "~/shared/content/content-schema.css";

export function createContentCheckListItemNodeView(
    node: Node,
    view: EditorView,
    getPos: () => number,
): NodeView {
    const {dom} = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));

    const checkboxDom = document.createElement("div");
    dom.appendChild(checkboxDom);
    checkboxDom.className = checkListItemCheckboxClassName;
    checkboxDom.innerHTML = checkIconSvg;

    const checkboxHitAreaDom = document.createElement("div");
    checkboxDom.appendChild(checkboxHitAreaDom);
    checkboxHitAreaDom.className = checkListItemCheckboxHitAreaClassName;

    const contentDom = document.createElement("div");
    dom.appendChild(contentDom);
    contentDom.className = checkListItemContentClassName;

    checkboxDom.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;

        // We don't want to select surrounding text when double clicking this element.
        // So we need to both prevent default (prevents browser selection) and stop
        // propagation (prevents ProseMirror selection).
        event.preventDefault();
        event.stopPropagation();

        checkboxDom.classList.add(checkListItemCheckboxPressedClassName);
    });

    checkboxDom.addEventListener("pointerup", event => {
        if (event.button !== 0) return;

        checkboxDom.classList.remove(checkListItemCheckboxPressedClassName);

        view.dispatch(
            view.state.tr.setNodeMarkup(getPos(), null, {
                ...node.attrs,
                checked: !node.attrs.checked,
            }),
        );
    });

    // If the user presses and moves their pointer off of the element then the
    // `pointerout` event is fired.
    checkboxDom.addEventListener("pointerout", () => {
        checkboxDom.classList.remove(checkListItemCheckboxPressedClassName);
    });

    return {
        dom,
        contentDOM: contentDom,
        ignoreMutation: mutation => {
            // Ignore changes to the `class` attribute so that the node isn't recreated
            // when we update classes.
            return mutation.type === "attributes" && mutation.attributeName === "class";
        },
    };
}

// Hardcode Phosphor check icon SVG since we don't want to mount a React root
// for every checkbox.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Check;

const checkIconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"></rect><polyline points="216 72 104 184 48 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"></polyline></svg>';
