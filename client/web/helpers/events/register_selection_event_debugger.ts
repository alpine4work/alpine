/* eslint-disable no-console, prefer-rest-params */

import {assert} from "~/shared/helpers/control/assert.js";

assert(process.env.NODE_ENV === "development");

// The focus event debugger is a useful tool if your elements are
// focusing/unfocusing in ways you don't expect. It logs all focus events allowing
// you to attach a debugger and explore the provenance of a focus.
//
// This script should not be imported in production or tests! It likely has a
// pretty negative performance impact.
if (typeof window !== "undefined") {
    document.addEventListener(
        "selectionchange",
        () => {
            console.log(`[SelectionEventDebugger] selectionchange event`);
        },
        {capture: true},
    );

    {
        // `Selection` methods that change selection state:
        // https://developer.mozilla.org/en-US/docs/Web/API/Selection
        const methodNames: ReadonlyArray<keyof Selection> = [
            "addRange",
            "collapse",
            "collapseToEnd",
            "collapseToStart",
            "deleteFromDocument",
            "empty",
            "extend",
            "modify",
            "removeRange",
            "removeAllRanges",
            "selectAllChildren",
            "setBaseAndExtent",
            "setPosition",
        ] as const;

        for (const methodName of methodNames) {
            const originalMethod = (Selection.prototype as any)[methodName];
            if (!originalMethod) continue;

            (Selection.prototype as any)[methodName] = function () {
                console.log(`[SelectionEventDebugger] Selection.${methodName}()`, ...arguments);
                return originalMethod.apply(this, arguments as any);
            };
        }
    }

    {
        // `Range` methods that change selection state:
        // https://developer.mozilla.org/en-US/docs/Web/API/Range
        //
        // Arguably, our debugger should check to see if the range is a part of the
        // selection before logging these changes.
        const methodNames: ReadonlyArray<keyof Range> = [
            "collapse",
            "deleteContents",
            "insertNode",
            "selectNode",
            "selectNodeContents",
            "setEnd",
            "setStart",
            "setEndAfter",
            "setEndBefore",
            "setStartAfter",
            "setStartBefore",
            "surroundContents",
        ] as const;

        for (const methodName of methodNames) {
            const originalMethod = (Range.prototype as any)[methodName];
            if (!originalMethod) continue;

            (Range.prototype as any)[methodName] = function () {
                console.log(`[SelectionEventDebugger] Range.${methodName}()`, ...arguments);
                return originalMethod.apply(this, arguments as any);
            };
        }
    }
}
