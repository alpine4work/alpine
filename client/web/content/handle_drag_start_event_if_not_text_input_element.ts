import {getSelectionClipboardData} from "~/client/web/content/handle_copy_event_if_not_text_input_element.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";

/**
 * We override the `dragstart` event when the selection is not entirely within
 * a text input element. This allows us to have custom behavior for the
 * draggable HTML of components in our DOM. For example, we can use our content
 * clipboard serializer when the user is dragging from `<ContentView>`.
 *
 * This uses the same underlying DOM serialization logic as our custom copy
 * command `handleCopyEventIfNotTextInputElement()`.
 */
export function handleDragStartEventIfNotTextInputElement(event: DragEvent) {
    // If focus is in a text input element then we want to let the text input
    // element handle the `dragstart` event. Or let the browser perform its default
    // drag behavior.
    if (document.activeElement && isTextInputElement(document.activeElement)) {
        return;
    }

    if (!event.dataTransfer) return;

    const selection = document.getSelection();
    if (!selection || !selection.anchorNode || !selection.focusNode || selection.isCollapsed) {
        return;
    }

    const result = getSelectionClipboardData({
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
    });

    event.dataTransfer.clearData();

    if (result) {
        event.dataTransfer.setData("text/html", result.html.innerHTML);
        event.dataTransfer.setData("text/plain", result.text);
    }
}
