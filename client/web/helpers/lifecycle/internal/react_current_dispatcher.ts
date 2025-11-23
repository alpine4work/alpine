import React from "react";

/**
 * A set we add React dispatchers to while rendering. Currently only
 * `useEvent()` adds to this set. So if no `useEvent()` hook is mounted we
 * won't have seen any React dispatchers.
 */
export const reactDispatchersSeenDuringRender = new Set();

/**
 * While rendering, React sets a shared `ReactCurrentDispatcher` internal to this
 * property. We inspect this property to tell if React is rendering or not.
 */
export function getCurrentReactDispatcherIfExists() {
    return (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
        .current;
}
