import {DOMSerializer, Node} from "prosemirror-model";
import {NodeView} from "prosemirror-view";
import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {clipboardTextIconSvg} from "~/client/icons/clipboard_text_icon_svg.js";
import {spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {backgroundColorVar, contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

export function createContentEditorCodeBlockNodeView(node: Node): NodeView {
    const {dom: element, contentDOM: contentElement} = DOMSerializer.renderSpec(
        document,
        node.type.spec.toDOM!(node),
    );

    assert(element instanceof HTMLElement && element.tagName === "PRE");
    assert(contentElement instanceof HTMLElement && contentElement.tagName === "CODE");
    assert(element.childElementCount === 1);
    assert(element.firstElementChild === contentElement);

    const toolbarElement = document.createElement("div");
    element.insertBefore(toolbarElement, contentElement);
    toolbarElement.contentEditable = "false";
    toolbarElement.className = sprinkles({
        zIndex: "20",
        position: "sticky",
        left: "0",
        height: "0",
        width: "full",
        // Override `cursor: text` and `user-select: text` set on the content editor.
        cursor: "auto",
        userSelect: "none",
    });

    const toolbarFlexElement = document.createElement("div");
    toolbarElement.appendChild(toolbarFlexElement);
    toolbarFlexElement.className = sprinkles({
        position: "absolute",
        right: "0",
        height: "6",
        paddingLeft: "1.5",
        paddingRight: contentSchemaStyles.blockPaddingX,
        display: "flex",
        alignItems: "center",
        gap: "1",
    });
    toolbarFlexElement.style.top = `calc((1lh - ${spacing["6"]}) / 2)`;
    toolbarFlexElement.style.backgroundColor = backgroundColorVar;
    toolbarFlexElement.style.maxWidth = subtractRemLengths(
        contentSchemaStyles.codeBlockToolbarMaxWidth,
        // The overflow gradient is rendered absolutely out of this element's layout
        // but we still want to consider it as a part of the max width.
        spacing[contentSchemaStyles.codeBlockPaddingRight],
    );

    const toolbarOverflowGradientElement = document.createElement("div");
    toolbarFlexElement.appendChild(toolbarOverflowGradientElement);
    toolbarOverflowGradientElement.className = sprinkles({
        position: "absolute",
        top: "0",
        bottom: "0",
        left: `-${contentSchemaStyles.codeBlockPaddingRight}`,
        width: contentSchemaStyles.codeBlockPaddingRight,
    });
    toolbarOverflowGradientElement.style.background = `linear-gradient(to left, ${backgroundColorVar}, transparent)`;

    {
        const languagePickerElement = document.createElement("div");
        toolbarFlexElement.appendChild(languagePickerElement);
        languagePickerElement.className = sprinkles({
            height: "6",
            paddingX: "1.5",
            display: "flex",
            alignItems: "center",
            borderRadius: "1",
            // Don't allow item to grow beyond flexbox bounds. By default flexbox items
            // have `min-width: auto` which extends with content.
            // https://stackoverflow.com/a/66689926/1568890
            minWidth: "0",
        });

        const languagePickerElementText = document.createElement("div");
        languagePickerElement.appendChild(languagePickerElementText);
        languagePickerElementText.className = sprinkles({
            fontStyle: "truncate",
            fontSize: "75",
            color: "grey-100",
        });

        // NOCOMMIT: Actual name
        languagePickerElementText.appendChild(document.createTextNode("JavaScript"));

        addUnfocusableButtonBehaviorToElement(languagePickerElement, {
            hoverClassName: sprinkles({
                backgroundColor: "grey-5",
            }),
            pressClassName: sprinkles({
                backgroundColor: "grey-10",
            }),
        });
    }

    {
        // NOCOMMIT: Don't render on mobile. Reduce `codeBlockToolbarMaxWidth` by 6 on mobile as well.
        const copyButtonElement = document.createElement("div");
        toolbarFlexElement.appendChild(copyButtonElement);
        copyButtonElement.className = sprinkles({
            flexShrink: "0",
            width: "6",
            height: "6",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            borderRadius: "full",
        });
        copyButtonElement.innerHTML = clipboardTextIconSvg({
            className: sprinkles({
                width: "4",
                height: "4",
            }),
        });

        addUnfocusableButtonBehaviorToElement(copyButtonElement, {
            defaultClassName: sprinkles({
                color: "grey-70",
            }),
            hoverClassName: sprinkles({
                color: "grey-70",
                backgroundColor: "grey-5",
            }),
            pressClassName: sprinkles({
                color: "grey-100",
                backgroundColor: "grey-10",
            }),
        });
    }

    return {
        dom: element,
        contentDOM: contentElement,
        ignoreMutation: mutation => {
            // Ignore changes to the `class` attribute for elements in our toolbar so that
            // the node isn't recreated when we update classes.
            return (
                mutation.type === "attributes" &&
                mutation.attributeName === "class" &&
                toolbarElement.contains(mutation.target)
            );
        },
    };
}

function addUnfocusableButtonBehaviorToElement(
    element: HTMLElement,
    {
        defaultClassName = "",
        hoverClassName = "",
        pressClassName = "",
        onPress,
    }: {
        defaultClassName?: string;
        hoverClassName?: string;
        pressClassName?: string;
        onPress?: () => void;
    } = {},
): () => void {
    const defaultClassList = defaultClassName.length > 0 ? defaultClassName.split(" ") : [];
    const hoverClassList = hoverClassName.length > 0 ? hoverClassName.split(" ") : [];
    const pressClassList = pressClassName.length > 0 ? pressClassName.split(" ") : [];

    element.classList.add(
        contentSchemaStyles.parentScrollWhenPointerDownAndOverReceiverClassName,
        ...defaultClassList,
    );

    let isPointerOver = false;
    let isPointerDownAndOver = false;

    let state: "Pressed" | "Hovered" | null = null;

    const maybeUpdateStyle = () => {
        const oldState = state;
        const newState = isPointerDownAndOver ? "Pressed" : isPointerOver ? "Hovered" : null;

        state = newState;

        if (oldState === newState) return;

        switch (oldState) {
            case null:
                element.classList.remove(...defaultClassList);
                break;
            case "Pressed":
                element.classList.remove(...pressClassList);
                break;
            case "Hovered":
                element.classList.remove(...hoverClassList);
                break;
            default:
                throw exhaustive(oldState);
        }

        switch (newState) {
            case null:
                element.classList.add(...defaultClassList);
                break;
            case "Pressed":
                element.classList.add(...pressClassList);
                break;
            case "Hovered":
                element.classList.add(...hoverClassList);
                break;
            default:
                throw exhaustive(newState);
        }
    };

    const handlePointerDown = (event: PointerEvent) => {
        isPointerDownAndOver = event.button === 0 && !isModifiedPointerEvent(event);
        maybeUpdateStyle();

        // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
        // modifier.
        if (event.button !== 0 || isModifiedPointerEvent(event)) return;

        // Prevent focus from moving or text from being selected.
        event.preventDefault();
    };

    const handlePointerUp = () => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        // Only process pointer up events that started on our element.
        if (!wasPointerDownAndOver) return;

        onPress?.();
    };

    const handlePointerEnter = () => {
        isPointerOver = true;
        maybeUpdateStyle();
    };

    const handlePointerLeave = () => {
        isPointerOver = false;
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handlePointerCancel = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handleDragStart = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handleParentScrollWhenPointerDownAndOver = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointerenter", handlePointerEnter);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("pointercancel", handlePointerCancel);
    element.addEventListener("dragstart", handleDragStart);
    addParentScrollWhenPointerDownAndOverListener(
        element,
        handleParentScrollWhenPointerDownAndOver,
    );

    return () => {
        element.classList.remove(
            contentSchemaStyles.parentScrollWhenPointerDownAndOverReceiverClassName,
            ...defaultClassList,
            ...hoverClassList,
            ...pressClassList,
        );

        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointerenter", handlePointerEnter);
        element.removeEventListener("pointerleave", handlePointerLeave);
        element.removeEventListener("pointercancel", handlePointerCancel);
        element.removeEventListener("dragstart", handleDragStart);
        removeParentScrollWhenPointerDownAndOverListener(
            element,
            handleParentScrollWhenPointerDownAndOver,
        );
    };
}
