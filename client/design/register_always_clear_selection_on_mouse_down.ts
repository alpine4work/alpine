import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {withoutClearSelectionOnMouseDownClassName} from "~/client/styles/styles.js";

/**
 * By default, the browser clears your selection if you click on an element
 * with `user-select: text`. However, the browser won't clear your selection by
 * default if you click on an element with `user-select: none`. Given in our
 * CSS we default everything to `user-select: none`
 * (see `global_2_defaults.css.ts`) we have some JavaScript that makes sure the
 * selection is always cleared on mouse down even if we're clicking an element
 * with `user-select: none`.
 */
export function registerAlwaysClearSelectionOnMouseDown() {
    document.documentElement.addEventListener("pointerdown", event => {
        if (!(event.target instanceof Element)) return;

        // We haven't considered whether this is the right behavior for touch events.
        if (event.pointerType !== "mouse") return;

        // Make sure there's a selection to clear.
        const selection = window.getSelection();
        if (!selection) return;
        if (selection.isCollapsed) return;

        const isPointerDownFromSelectableElement =
            (getComputedStyle(event.target).userSelect ||
                // In Safari `user-select` is behind a vendor prefix.
                getComputedStyle(event.target).webkitUserSelect) !== "none";

        // If the click is in an element with `user-select: text` then the browser
        // should clear our selection automatically.
        if (isPointerDownFromSelectableElement) return;

        // Make sure the click isn't in an editable element.
        if (isTextInputElement(event.target)) return;
        if (event.target.closest("[contenteditable]")) return;

        // Class you can use to disable this behavior. We use it for pointer toolbar
        // components. Where you'll click buttons to interact with the selection.
        if (event.target.closest(`.${withoutClearSelectionOnMouseDownClassName}`)) return;

        selection.removeAllRanges();
    });
}
