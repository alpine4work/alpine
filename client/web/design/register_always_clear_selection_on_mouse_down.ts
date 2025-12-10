import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {withoutClearSelectionOnMouseDownClassName} from "~/client/web/styles/styles.js";

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
    // Must be on `window` (not `document.documentElement`) so if a React
    // `onPointerDown` handler calls `event.preventDefault()` (like
    // `useOutOfBoundsClickSelection()`) then we see the default was prevented
    // in this function.
    window.addEventListener("pointerdown", event => {
        // Fixes triple clicking empty space in a task title input (managed by
        // `useOutOfBoundsClickSelection()`) deselecting the task title.
        if (event.defaultPrevented) return;

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
        //
        // TODO(calebmer): I think it could be better if everywhere we use
        // `withoutClearSelectionOnMouseDownClassName` we instead call
        // `event.preventDefault()`. Use the natural semantics of the browser instead
        // of a random one-off CSS class.
        if (event.target.closest(`.${withoutClearSelectionOnMouseDownClassName}`)) return;

        selection.removeAllRanges();
    });
}
