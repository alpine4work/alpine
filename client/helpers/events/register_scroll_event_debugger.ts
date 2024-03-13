/* eslint-disable no-console, prefer-rest-params */

import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

assert(process.env.NODE_ENV === "development");

// The scroll event debugger is a useful tool if your elements are scrolling in
// ways you don't expect. It logs all scroll events allowing you to attach a
// debugger and explore the provenance of a scroll.
//
// This script should not be imported in production or tests! It likely has a
// pretty negative performance impact.
//
// I (@calebmer) have founding myself needing a tool like this a couple times.
// We do a lot of advanced things in many different code paths with scroll
// positioning (e.g. `<VirtualizedScrollView>`,
// `useScrollToAvoidMobileKeyboard()`, `useScrollToNewMessages()`) so being able
// to track down an errant scroll is super useful.
if (typeof window !== "undefined") {
    let nextScrollElementDebugId = 1;
    const debugIdByScrollElement = new WeakMap<Element, number>();

    function getScrollElementDebugId(element: Element) {
        let debugId = debugIdByScrollElement.get(element);
        if (debugId !== undefined) return debugId;

        debugId = nextScrollElementDebugId++;
        debugIdByScrollElement.set(element, debugId);

        console.log(`[ScrollEventDebugger#${debugId}] registered`, element);

        element.addEventListener("scroll", () => {
            console.log(
                `[ScrollEventDebugger#${debugId!}] scroll event`,
                element.scrollTop,
                element.scrollLeft,
            );
        });

        return debugId;
    }

    const originalScrollTopPropertyDescriptor = assertExists(
        Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
    );
    const originalScrollLeftPropertyDescriptor = assertExists(
        Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft"),
    );

    Object.defineProperty(Element.prototype, "scrollTop", {
        ...originalScrollTopPropertyDescriptor,
        set: function (this: Element) {
            const debugId = getScrollElementDebugId(this);
            console.log(`[ScrollEventDebugger#${debugId}] set scrollTop`, ...arguments);
            originalScrollTopPropertyDescriptor.set!.apply(this, arguments as any);
        },
    });

    Object.defineProperty(Element.prototype, "scrollLeft", {
        ...originalScrollLeftPropertyDescriptor,
        set: function (this: Element) {
            const debugId = getScrollElementDebugId(this);
            console.log(`[ScrollEventDebugger#${debugId}] set scrollLeft`, ...arguments);
            originalScrollLeftPropertyDescriptor.set!.apply(this, arguments as any);
        },
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollTo = Element.prototype.scrollTo;

    Element.prototype.scrollTo = function () {
        const debugId = getScrollElementDebugId(this);
        console.log(`[ScrollEventDebugger#${debugId}] scrollTo()`, ...arguments);
        return originalScrollTo.apply(this, arguments as any);
    };
}
