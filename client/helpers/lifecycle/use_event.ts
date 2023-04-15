import React, {Memo, useCallback, useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";

const reactDispatchersSeenDuringRender = new Set();

/**
 * Allows you to define event handlers that can read the latest props/state but
 * has a stable function identity.
 *
 * These event callbacks may not be called in React render functions! An error
 * will be thrown.
 *
 * Uses a modified version of the user-land implementation included in the
 * [`useEvent()` RFC][1]. Our version until such a hook is available natively.
 *
 * The RFC was closed on 27 September 2022, the React team plans to come up
 * with a new RFC to provide similar functionality in the future. We will
 * migrate to this functionality when available.
 *
 * IMPORTANT CAVEAT: You should not call event callbacks in layout effects of
 * React component children! Internally this hook uses a layout effect and
 * parent component layout effects run after child component layout effects.
 * Use this hook responsibly.
 *
 * [1]: https://github.com/reactjs/rfcs/pull/220
 */
export function useEvent<Args extends Array<unknown>, Return>(
    handler: (...args: Args) => Return,
): Memo<(...args: Args) => Return>;
export function useEvent<Args extends Array<unknown>>(
    handler: ((...args: Args) => void) | undefined,
): Memo<(...args: Args) => void>;
export function useEvent<Args extends Array<unknown>>(
    handler: ((...args: Args) => void) | undefined,
): Memo<(...args: Args) => unknown> {
    const handlerRef = useRef(handler);

    // In a real implementation, this would run before layout effects.
    //
    // Calling this handler in a layout effect of a child component will give
    // you weird results! Since child component layout effects run before
    // parent component layout effects.
    //
    // Be careful when using this hook.
    useLayoutEffectWithoutServerSideWarning(() => {
        handlerRef.current = handler;
    });

    {
        const dispatcher = getCurrentReactDispatcherIfExists();
        assert(dispatcher !== null);
        reactDispatchersSeenDuringRender.add(dispatcher);
    }

    return useCallback((...args: Args) => {
        if (reactDispatchersSeenDuringRender.has(getCurrentReactDispatcherIfExists()))
            throw new InternalError("Can not call event callback during React render");

        return handlerRef.current?.(...args);
    }, []);
}

/**
 * While rendering, React sets a shared `ReactCurrentDispatcher` internal to this
 * property. We inspect this property to tell if React is rendering or not.
 */
function getCurrentReactDispatcherIfExists() {
    return (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher
        .current;
}
