/* eslint-disable no-console, prefer-rest-params */

import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

assert(process.env.NODE_ENV === "development");

// The scroll event debugger is a useful tool if your elements are scrolling in
// ways you don't expect. It logs all scroll events allowing you to attach a
// debugger and explore the provenance of a scroll.
//
// This script should not be imported in production or tests! It likely has a
// pretty negative performance impact.
//
// I (@calebmer) have founding myself needing a tool like this a couple times. We
// do a lot of advanced things in many different code paths with scroll positioning
// (e.g. `<VirtualizedScrollView>`, `useScrollToAvoidMobileKeyboard()`,
// `useScrollToNewMessages()`) so being able to track down an errant scroll is
// super useful.
if (typeof window !== "undefined") {
    let nextScrollElementDebugId = 1;
    const debugIdByScrollElement = new WeakMap<Element, number>();

    function getScrollElementDebugId(element: Element): number | null {
        let debugId = debugIdByScrollElement.get(element);
        if (debugId !== undefined) return debugId;

        const {overflowX, overflowY} = getComputedStyle(element);

        // If `element.scrollTop = 0` was set on a non-scrollable element (which happens
        // for ProseMirror `<EditorView>`s) we don't want our debugger to log the scroll.
        if (
            element.scrollTop === 0 &&
            element.scrollLeft === 0 &&
            overflowX !== "auto" &&
            overflowX !== "scroll" &&
            overflowY !== "auto" &&
            overflowY !== "scroll"
        ) {
            return null;
        }

        debugId = nextScrollElementDebugId++;
        debugIdByScrollElement.set(element, debugId);

        console.log(`[ScrollEventDebugger#${debugId}] registered`, element);

        if (element !== document.body) {
            element.addEventListener("scroll", () => {
                console.log(
                    `[ScrollEventDebugger#${debugId}] scroll event`,
                    element.scrollTop,
                    element.scrollLeft,
                );
            });
        }

        return debugId;
    }

    const setterPropertyNames = ["scrollTop", "scrollLeft"];

    for (const setterPropertyName of setterPropertyNames) {
        const originalPropertyDescriptor = assertExists(
            Object.getOwnPropertyDescriptor(Element.prototype, setterPropertyName),
        );

        Object.defineProperty(Element.prototype, setterPropertyName, {
            ...originalPropertyDescriptor,
            set: function (this: Element) {
                const debugId = getScrollElementDebugId(this);
                if (debugId !== null) {
                    console.log(
                        `[ScrollEventDebugger#${debugId}] set ${setterPropertyName}`,
                        ...arguments,
                    );
                }
                originalPropertyDescriptor.set!.apply(this, arguments as any);
            },
        });
    }

    const methodNames: ReadonlyArray<keyof Element | "scrollIntoViewIfNeeded"> = [
        "scroll",
        "scrollBy",
        "scrollIntoView",
        "scrollIntoViewIfNeeded",
        "scrollTo",
    ];

    for (const methodName of methodNames) {
        const originalMethod = (Element.prototype as any)[methodName];
        if (!originalMethod) continue;

        (Element.prototype as any)[methodName] = function () {
            const debugId = getScrollElementDebugId(this);
            if (debugId !== null) {
                console.log(`[ScrollEventDebugger#${debugId}] ${methodName}()`, ...arguments);
            }
            return originalMethod.apply(this, arguments as any);
        };
    }

    // Make sure we always log for scroll events on `<body>`. Even if we there isn't a
    // scroll property set or scroll method call on `<body>` first.
    document.body.addEventListener("scroll", () => {
        const debugId = getScrollElementDebugId(document.body);

        console.log(
            `[ScrollEventDebugger#${debugId}] scroll event`,
            document.body.scrollTop,
            document.body.scrollLeft,
        );
    });
}
