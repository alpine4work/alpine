import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {contentCheckListItemIconSvg} from "~/shared/content/content_check_list_item_icon_svg.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

const {
    checkListItemCheckboxClassName,
    checkListItemCheckboxContainerClassName,
    checkListItemCheckboxPressedClassName,
    checkListItemContentClassName,
} = contentSchemaStyles;

export function createContentEditorCheckListItemNodeView(
    node: Node,
    view: EditorView,
    getPos: () => number,
): NodeView {
    const {dom} = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));

    const checkboxContainerDom = document.createElement("div");
    dom.appendChild(checkboxContainerDom);
    checkboxContainerDom.className = checkListItemCheckboxContainerClassName;

    const checkboxDom = document.createElement("div");
    checkboxContainerDom.appendChild(checkboxDom);
    checkboxDom.className = checkListItemCheckboxClassName;
    checkboxDom.innerHTML = contentCheckListItemIconSvg;

    const contentDom = document.createElement("div");
    dom.appendChild(contentDom);
    contentDom.className = checkListItemContentClassName;

    let isPointerDownAndNotPointerOut = false;

    checkboxContainerDom.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;

        // We don't want to select surrounding text when double clicking this element.
        // So we need to both prevent default (prevents browser selection) and stop
        // propagation (prevents ProseMirror selection).
        event.preventDefault();
        event.stopPropagation();

        isPointerDownAndNotPointerOut = true;
        checkboxDom.classList.add(checkListItemCheckboxPressedClassName);
    });

    checkboxContainerDom.addEventListener("pointerup", event => {
        if (event.button !== 0) return;

        if (!isPointerDownAndNotPointerOut) return;
        isPointerDownAndNotPointerOut = false;
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
    checkboxContainerDom.addEventListener("pointerout", () => {
        isPointerDownAndNotPointerOut = false;
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
