import {
    getCurrentReactDispatcherIfExists,
    reactDispatchersSeenDuringRender,
} from "~/client/helpers/lifecycle/internal/react_current_dispatcher.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * Throws an error if react is currently rendering.
 */
export function throwIfRendering() {
    // TODO(calebmer): `reactDispatchersSeenDuringRender` is populated by
    // `useEvent()` hooks. If there are no `useEvent()` hooks on the page we won't
    // know what the render React dispatchers are.
    //
    // Maybe we should populate `reactDispatchersSeenDuringRender` from the root
    // component in our app? Or a context provider?
    if (reactDispatchersSeenDuringRender.has(getCurrentReactDispatcherIfExists())) {
        throw new InternalError("Can’t call this function while React is rendering");
    }
}
