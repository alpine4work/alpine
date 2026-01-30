import React from "react";
import {InternalError} from "~/shared/error/error.js";

const ReactSharedInternals = (React as any)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * Throws an error if React is currently rendering.
 */
export function throwIfRendering() {
    // React hasn't initialized shared internals:
    // https://github.com/facebook/react/blob/fd524fe02a86c3e92a207d90da970941320f337f/packages/react/src/ReactHooks.js#L25
    if (!ReactSharedInternals.H) return;

    // If the implementation of `useRef` and `useState` is the same then we assume
    // the implementation is `throwInvalidHookError` which means React isn't
    // rendering:
    // https://github.com/facebook/react/blob/fd524fe02a86c3e92a207d90da970941320f337f/packages/react-reconciler/src/ReactFiberHooks.js#L3876-L3877
    if (ReactSharedInternals.H.useRef === ReactSharedInternals.H.useState) {
        return;
    }

    throw new InternalError("Can\u2019t call this function while React is rendering");
}
