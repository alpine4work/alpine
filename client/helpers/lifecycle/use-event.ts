import {useCallback, useDebugValue, useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use-layout-effect-without-server-side-warning";
import {assert} from "~/shared/helpers/control/assert";

export function useEvent<Args extends Array<unknown>, Result>(
    handler: (...args: Args) => Result,
): (...args: Args) => Result {
    const handlerRef = useRef<(...args: Args) => Result>();

    // In a real implementation, this would run before layout effects
    useLayoutEffectWithoutServerSideWarning(() => {
        handlerRef.current = handler;
    });

    useDebugValue(handler);

    return useCallback((...args: Args) => {
        // In a real implementation, this would throw if called during render
        const fn = handlerRef.current;
        assert(fn, "fn does not exist");
        return fn(...args);
    }, []);
}
