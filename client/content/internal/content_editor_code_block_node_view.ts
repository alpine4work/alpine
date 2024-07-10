import {DOMSerializer} from "prosemirror-model";
import {NodeViewConstructor, serializeForClipboard} from "prosemirror-view";
import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {
    addTriggeredOverlayCloseEventListener,
    addTriggeredOverlayOpenEventListener,
    removeTriggeredOverlayCloseEventListener,
    removeTriggeredOverlayOpenEventListener,
} from "~/client/design/overlay_trigger_button.js";
import {Reporter} from "~/client/design/reporter.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {clipboardTextIconSvg} from "~/client/icons/clipboard_text_icon_svg.js";
import {
    ContentCodeBlockLanguageId,
    contentCodeBlockLanguageById,
} from "~/shared/content/content_code_block_language.js";
import {spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {backgroundColorVar, contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

export function createContentEditorCodeBlockNodeViewConstructor({
    getReporter,
    onCodeBlockLanguagePickerOpen,
    onCodeBlockCopyButtonHoverStart,
    onCodeBlockCopyButtonHoverEnd,
    onCodeBlockCopyButtonPress,
}: {
    getReporter: () => Reporter;
    onCodeBlockLanguagePickerOpen: (options: {
        targetElement: HTMLElement;
        languageId: ContentCodeBlockLanguageId;
        getPos: () => number;
    }) => void;
    onCodeBlockCopyButtonHoverStart: (targetElement: HTMLElement) => void;
    onCodeBlockCopyButtonHoverEnd: (targetElement: HTMLElement) => void;
    onCodeBlockCopyButtonPress: (targetElement: HTMLElement) => void;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
        const language = contentCodeBlockLanguageById[languageId];

        const {dom: element, contentDOM: contentElement} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(element instanceof HTMLElement && element.tagName === "PRE");
        assert(contentElement instanceof HTMLElement && contentElement.tagName === "CODE");
        assert(element.childElementCount === 1);
        assert(element.firstElementChild === contentElement);

        const destroyCallbacks: Array<() => void> = [];

        const toolbarElement = document.createElement("div");
        element.insertBefore(toolbarElement, contentElement);
        toolbarElement.contentEditable = "false";
        toolbarElement.className = sprinkles({
            pointerEvents: "none",
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
            pointerEvents: "auto",
            position: "absolute",
            top: "0",
            right: "0",
            height: contentSchemaStyles.codeBlockToolbarHeight,
            paddingLeft: "1.5",
            paddingRight: contentSchemaStyles.blockPaddingX,
            display: "flex",
            alignItems: "center",
        });
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
            pointerEvents: "none",
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
                height: contentSchemaStyles.codeBlockToolbarHeight,
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
            });

            languagePickerElementText.appendChild(document.createTextNode(language.name));

            // We don't need to cleanup event listeners on DOM nodes created for this
            // node view.
            addUnfocusableButtonBehaviorToElement(languagePickerElement, {
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
                onPress: () => {
                    onCodeBlockLanguagePickerOpen({
                        targetElement: languagePickerElement,
                        languageId,
                        getPos,
                    });
                },
            });
        }

        {
            // NOCOMMIT: Don't render on mobile. Reduce `codeBlockToolbarMaxWidth` by 6 on mobile as well.
            const copyButtonElement = document.createElement("div");
            toolbarFlexElement.appendChild(copyButtonElement);
            copyButtonElement.className = sprinkles({
                flexShrink: "0",
                width: contentSchemaStyles.codeBlockToolbarHeight,
                height: contentSchemaStyles.codeBlockToolbarHeight,
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

            let isCodeBlockCopyButtonHovered = false;

            // We don't need to cleanup event listeners on DOM nodes created for this
            // node view.
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
                onHoverStart: () => {
                    const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                    isCodeBlockCopyButtonHovered = true;

                    if (!wasCodeBlockCopyButtonHovered)
                        onCodeBlockCopyButtonHoverStart(copyButtonElement);
                },
                onHoverEnd: () => {
                    const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                    isCodeBlockCopyButtonHovered = false;
                    if (wasCodeBlockCopyButtonHovered)
                        onCodeBlockCopyButtonHoverEnd(copyButtonElement);
                },
                onPress: () => {
                    const pos = getPos();

                    const {dom, text} = serializeForClipboard(
                        view,
                        view.state.doc.slice(pos, pos + node.nodeSize),
                    );

                    navigator.clipboard
                        .write([
                            new ClipboardItem({
                                "text/html": new Blob([dom.innerHTML], {type: "text/html"}),
                                "text/plain": new Blob([text], {type: "text/plain"}),
                            }),
                        ])
                        .catch(error => {
                            getReporter().displayError("Couldn’t copy code", error);
                        });

                    onCodeBlockCopyButtonPress(copyButtonElement);
                },
            });

            destroyCallbacks.push(() => {
                if (isCodeBlockCopyButtonHovered) {
                    isCodeBlockCopyButtonHovered = false;
                    onCodeBlockCopyButtonHoverEnd(copyButtonElement);
                }
            });
        }

        return {
            dom: element,
            contentDOM: contentElement,
            destroy: () => {
                for (const destroyCallback of destroyCallbacks) {
                    destroyCallback();
                }
            },
            ignoreMutation: mutation => {
                // Ignore any attribute mutation for elements in the toolbar. It's expected
                // that we'll modify `class` when hovered/pressed and it's expected that
                // `<Tooltip>` on `copyButtonElement` will change `aria-owns` and other
                // properties.
                return mutation.type === "attributes" && toolbarElement.contains(mutation.target);
            },
        };
    };
}

function addUnfocusableButtonBehaviorToElement(
    element: HTMLElement,
    {
        defaultClassName = "",
        hoverClassName = "",
        pressClassName = "",
        onHoverStart,
        onHoverEnd,
        onPress,
    }: {
        defaultClassName?: string;
        hoverClassName?: string;
        pressClassName?: string;
        onHoverStart?: () => void;
        onHoverEnd?: () => void;
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
    let isTriggeredOverlayOpen = false;

    let state: "Pressed" | "Hovered" | null = null;

    const maybeUpdateStyle = () => {
        const oldState = state;
        const newState = isPointerDownAndOver
            ? "Pressed"
            : isPointerOver || isTriggeredOverlayOpen
            ? "Hovered"
            : null;

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

        if (wasPointerDownAndOver) onPress?.();
    };

    const handlePointerEnter = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = true;
        maybeUpdateStyle();

        if (!wasPointerOver) onHoverStart?.();
    };

    const handlePointerLeave = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = false;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        if (wasPointerOver) onHoverEnd?.();
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

    const handleTriggeredOverlayOpen = () => {
        isTriggeredOverlayOpen = true;
        maybeUpdateStyle();
    };

    const handleTriggeredOverlayClose = () => {
        isTriggeredOverlayOpen = false;
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
    addTriggeredOverlayOpenEventListener(element, handleTriggeredOverlayOpen);
    addTriggeredOverlayCloseEventListener(element, handleTriggeredOverlayClose);

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
        removeTriggeredOverlayOpenEventListener(element, handleTriggeredOverlayOpen);
        removeTriggeredOverlayCloseEventListener(element, handleTriggeredOverlayClose);
    };
}
