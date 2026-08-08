import {useCallback, useRef} from "react";
// eslint-disable-next-line no-restricted-imports
import {useRevalidator as useOriginalRevalidator} from "react-router";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    PromiseResolver,
    createPromiseResolver,
} from "~/shared/helpers/async/promise_resolver.open_source.js";

/**
 * Same as `useRevalidator()` from `react-router` but the `revalidate()` function
 * returns a promise that resolves when the revalidation is complete.
 */
export function useRevalidator() {
    const {state, revalidate: originalRevalidate} = useOriginalRevalidator();

    const promiseResolversRef = useRef<Array<PromiseResolver<void>> | null>(null);

    const revalidate = useCallback(() => {
        originalRevalidate();

        const promiseResolver = createPromiseResolver();

        promiseResolversRef.current ??= [];
        promiseResolversRef.current.push(promiseResolver);

        return promiseResolver.promise;
    }, [originalRevalidate]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (state === "idle") {
            const promiseResolvers = promiseResolversRef.current;
            promiseResolversRef.current = null;
            if (promiseResolvers !== null) {
                for (const promiseResolver of promiseResolvers) {
                    promiseResolver.resolve();
                }
            }
        }
    }, [state]);

    return {state, revalidate};
}
