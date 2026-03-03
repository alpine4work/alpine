import {Memo, useCallback, useMemo, useRef, useState} from "react";
import {throwIfRendering} from "~/client/web/helpers/lifecycle/throw_if_rendering.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";

/**
 * Allows you to define event handlers that can read the latest props/state but has
 * a stable function identity.
 *
 * These event callbacks may not be called in React render functions! An error will
 * be thrown.
 *
 * Uses a modified version of the user-land implementation included in the
 * [`useEvent()` RFC][1]. Our version until such a hook is available natively.
 *
 * The RFC was closed on 27 September 2022, the React team plans to come up with a
 * new RFC to provide similar functionality in the future. We will migrate to this
 * functionality when available.
 *
 * IMPORTANT CAVEAT: You should not call event callbacks in layout effects of React
 * component children! Internally this hook uses a layout effect and parent
 * component layout effects run after child component layout effects. Use this hook
 * responsibly.
 *
 * [1]: https://github.com/reactjs/rfcs/pull/220
 */
export function useEvent<Args extends Array<unknown>, Return>(
    event: (...args: Args) => Return,
): Memo<(...args: Args) => Return>;
export function useEvent<Args extends Array<unknown>, Return>(
    event: ((...args: Args) => Return) | undefined,
): Memo<(...args: Args) => Return | undefined>;
export function useEvent<Args extends Array<unknown>>(
    event: ((...args: Args) => void) | undefined,
): Memo<(...args: Args) => unknown> {
    const eventRef = useRef(event);

    // In a real implementation, this would run before layout effects.
    //
    // Calling this handler in a layout effect of a child component will give you weird
    // results! Since child component layout effects run before parent component layout
    // effects.
    //
    // Be careful when using this hook.
    useLayoutEffectWithoutServerSideWarning(() => {
        eventRef.current = event;
    });

    return useCallback((...args: Args) => {
        throwIfRendering();
        return eventRef.current?.(...args);
    }, []);
}

/**
 * Allows you to define event handlers that can read the latest props/state but has
 * a stable function identity. Similar to `useEvent()` but you can pass in multiple
 * event functions at once.
 *
 * These event callbacks may not be called in React render functions! An error will
 * be thrown.
 *
 * Uses a modified version of the user-land implementation included in the
 * [`useEvent()` RFC][1]. Our version until such a hook is available natively.
 *
 * The RFC was closed on 27 September 2022, the React team plans to come up with a
 * new RFC to provide similar functionality in the future. We will migrate to this
 * functionality when available.
 *
 * IMPORTANT CAVEAT: You should not call event callbacks in layout effects of React
 * component children! Internally this hook uses a layout effect and parent
 * component layout effects run after child component layout effects. Use this hook
 * responsibly.
 *
 * [1]: https://github.com/reactjs/rfcs/pull/220
 */
export function useEvents<Events extends {[key: string]: (...args: Array<any>) => unknown}>(
    events: Events,
): MemoObject<Events> {
    const [eventKeys] = useState(() => Object.keys(events));

    const eventsRef = useRef(events);

    // In a real implementation, this would run before layout effects.
    //
    // Calling this handler in a layout effect of a child component will give you weird
    // results! Since child component layout effects run before parent component layout
    // effects.
    //
    // Be careful when using this hook.
    useLayoutEffectWithoutServerSideWarning(() => {
        eventsRef.current = events;
    });

    return useMemo(() => {
        const eventsMemo: any = {};

        for (const eventKey of eventKeys) {
            eventsMemo[eventKey] = (...args: Array<any>) => {
                throwIfRendering();
                return eventsRef.current[eventKey]!(...args);
            };
        }

        return eventsMemo;
    }, [eventKeys]);
}
