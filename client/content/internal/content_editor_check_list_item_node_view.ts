import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {addParentScrollWhenPointerDownAndOverListener} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {checkIconSvg} from "~/client/icons/check_icon_svg.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {contentStyles} from "~/client/styles/styles.js";

export function createContentEditorCheckListItemNodeView(
    node: Node,
    view: EditorView,
    getPos: () => number,
): NodeView {
    const {dom} = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));

    const checkboxContainerDom = document.createElement("div");
    dom.appendChild(checkboxContainerDom);
    checkboxContainerDom.className = contentStyles.checkListItemCheckboxContainerClassName;

    const checkboxDom = document.createElement("div");
    checkboxContainerDom.appendChild(checkboxDom);
    checkboxDom.className = contentStyles.checkListItemCheckboxClassName;
    checkboxDom.innerHTML = checkIconSvg({
        className: contentStyles.checkListItemCheckboxIconClassName,
    });

    const contentDom = document.createElement("div");
    dom.appendChild(contentDom);
    contentDom.className = contentStyles.checkListItemContentClassName;

    let isPointerDownAndOver = false;

    checkboxContainerDom.addEventListener("pointerdown", event => {
        if (event.button !== 0 || isModifiedPointerEvent(event)) return;

        // We don't want to select surrounding text when double clicking this element.
        // So we need to both prevent default (prevents browser selection) and stop
        // propagation (prevents ProseMirror selection).
        event.preventDefault();
        event.stopPropagation();

        isPointerDownAndOver = true;
        checkboxDom.classList.add(contentStyles.checkListItemCheckboxPressedClassName);
    });

    checkboxContainerDom.addEventListener("pointerup", () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;

        if (wasPointerDownAndOver) {
            checkboxDom.classList.remove(contentStyles.checkListItemCheckboxPressedClassName);

            view.dispatch(
                view.state.tr.setNodeMarkup(getPos(), null, {
                    ...node.attrs,
                    checked: !node.attrs.checked,
                }),
            );

            // Reward the user with haptic feedback when they complete a check list item.
            NativeMobileBridge?.haptic.playLightImpact();
        }
    });

    checkboxContainerDom.addEventListener("pointerleave", () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;

        if (wasPointerDownAndOver) {
            checkboxDom.classList.remove(contentStyles.checkListItemCheckboxPressedClassName);
        }
    });

    checkboxContainerDom.addEventListener("pointercancel", () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;

        if (wasPointerDownAndOver) {
            checkboxDom.classList.remove(contentStyles.checkListItemCheckboxPressedClassName);
        }
    });

    checkboxContainerDom.addEventListener("dragstart", () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;

        if (wasPointerDownAndOver) {
            checkboxDom.classList.remove(contentStyles.checkListItemCheckboxPressedClassName);
        }
    });

    addParentScrollWhenPointerDownAndOverListener(checkboxContainerDom, () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;

        if (wasPointerDownAndOver) {
            checkboxDom.classList.remove(contentStyles.checkListItemCheckboxPressedClassName);
        }
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
