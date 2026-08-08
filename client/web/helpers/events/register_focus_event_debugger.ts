/* eslint-disable no-console, prefer-rest-params */

import {assert} from "~/shared/helpers/control/assert.open_source.js";

assert(process.env.NODE_ENV === "development");

// The focus event debugger is a useful tool if your elements are
// focusing/unfocusing in ways you don't expect. It logs all focus events allowing
// you to attach a debugger and explore the provenance of a focus.
//
// This script should not be imported in production or tests! It likely has a
// pretty negative performance impact.
if (typeof window !== "undefined") {
    let nextFocusableElementDebugId = 1;
    const debugIdByFocusableElement = new WeakMap<HTMLElement, number>();

    function getFocusElementDebugId(element: HTMLElement) {
        let debugId = debugIdByFocusableElement.get(element);
        if (debugId !== undefined) return debugId;

        debugId = nextFocusableElementDebugId++;
        debugIdByFocusableElement.set(element, debugId);

        console.log(`[FocusEventDebugger#${debugId}] registered`, element);

        return debugId;
    }

    document.addEventListener(
        "focusin",
        event => {
            if (event.target instanceof HTMLElement) {
                const debugId = getFocusElementDebugId(event.target);

                console.log(`[FocusEventDebugger#${debugId}] focus event`);
            }
        },
        {capture: true},
    );

    document.addEventListener(
        "focusout",
        event => {
            if (event.target instanceof HTMLElement) {
                const debugId = getFocusElementDebugId(event.target);

                console.log(`[FocusEventDebugger#${debugId}] blur event`);
            }
        },
        {capture: true},
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalFocus = HTMLElement.prototype.focus;

    HTMLElement.prototype.focus = function () {
        const debugId = getFocusElementDebugId(this);
        console.log(`[FocusEventDebugger#${debugId}] focus()`, ...arguments);
        return originalFocus.apply(this, arguments as any);
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalBlur = HTMLElement.prototype.blur;

    HTMLElement.prototype.blur = function () {
        const debugId = getFocusElementDebugId(this);
        console.log(`[FocusEventDebugger#${debugId}] blur()`, ...arguments);
        return originalBlur.apply(this, arguments as any);
    };
}
