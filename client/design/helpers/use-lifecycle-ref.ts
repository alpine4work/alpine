import {RefCallback, useCallback, useRef} from "react";

/**
 * A convenient helper for defining refs that add event listeners or attributes
 * imperatively to the referenced element.
 *
 * We expect this to be useful in conjunction with `useElementWithRef()`.
 *
 * If a sub-component re-renders and the ref changes then we will cleanup the
 * old ref’s listeners and subscribe new ones without re-rendering the component
 * this hook lives in. You can kind of think of this as a `useLayoutEffect()`
 * for refs.
 *
 * Use sparingly! Like `useLayoutEffect()` this does not work during server-side
 * rendering.
 *
 * Example:
 *
 * ```
 * const ref = useLifecycleRef(element => {
 *   element.addEventListener('focus', handleFocus);
 *   return () => {
 *     element.removeEventListener('focus', handleFocus);
 *   };
 * });
 *
 * return useElementWithRef(children, ref);
 * ```
 */
export function useLifecycleRef<T>(ref: (value: T) => (() => void) | undefined): RefCallback<T> {
    const valueRef = useRef<{
        value: T;
        cleanup: (() => void) | undefined;
    } | null>(null);

    return useCallback(
        value => {
            if (value === valueRef.current?.value) return;

            valueRef.current?.cleanup?.();

            if (value !== null) {
                valueRef.current = {value, cleanup: ref(value)};
            } else {
                valueRef.current = null;
            }
        },
        [ref],
    );
}
