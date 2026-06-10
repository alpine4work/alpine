import {RefObject} from "react";
import {ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function getContentEditorScrollAnchorPosition<Content extends ContentWithReferences>(
    editorRef: RefObject<ContentEditorRef<Content> | null>,
) {
    const editor = assertExists(editorRef.current);

    // If something other than the editor is focused, try using that element as a
    // scroll anchor.
    if (!editor.isFocused()) {
        const {activeElement} = document;

        if (activeElement !== null) {
            // If we focused on a listbox, scroll to make sure the element the listbox controls
            // is visible. For example, the code block language picker
            // (`<ContentEditorCodeBlockLanguagePickerComboBox>`).
            const ariaControlsAttribute = activeElement.getAttribute("aria-controls");
            if (ariaControlsAttribute) {
                const ariaControls = ariaControlsAttribute.split(" ")[0]!;
                let controlsElement = document.getElementById(ariaControls);

                // Support the case where our `listbox` is a `<ul>` wrapped in a `<div>` with
                // `overflow-y: auto`. We should use the size of the wrapping `<div>` not the
                // `<ul>`. Generally, perhaps we should call some kind of `getScrollParent()`
                // function.
                if (
                    controlsElement?.parentElement &&
                    getComputedStyle(controlsElement).overflowY === "visible" &&
                    getComputedStyle(controlsElement.parentElement).overflowY !== "visible"
                ) {
                    controlsElement = controlsElement.parentElement;
                }

                if (controlsElement) {
                    const activeRect = activeElement.getBoundingClientRect();
                    const controlsRect = controlsElement.getBoundingClientRect();

                    const anchorPosition = {
                        top: Math.min(activeRect.top, controlsRect.top),
                        bottom: Math.max(activeRect.bottom, controlsRect.bottom),
                    };

                    return {
                        top: anchorPosition.top,
                        height: anchorPosition.bottom - anchorPosition.top,
                        isPinned: false,
                    };
                }
            }
        }
    }

    const editorState = editor.getState();

    const coords = editor.coordsAtPos(editorState.getSelection().from);

    const spacingScale = getSpacingScaleWithoutListening();
    const paragraphLineHeight = contentStyles.paragraphLineHeightPx[spacingScale];

    // Add a paragraph line height in either direction as slop. We consider the
    // selection offscreen if there's less than a line of space between it and the
    // keyboard.
    return {
        top: coords.top - paragraphLineHeight,
        height: coords.bottom - coords.top + paragraphLineHeight * 2,
        isPinned: false,
    };
}
