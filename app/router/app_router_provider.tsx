import {RouterState} from "@remix-run/router";
import {startTransition, useCallback, useLayoutEffect, useMemo, useState} from "react";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Navigator,
    Router,
    RouterProviderProps,
    UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";

// NOCOMMIT: Document that this is a fork of:
// https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/react-router/lib/components.tsx#L89-L166
export function AppRouterProvider({
    fallbackElement,
    router,
    future,
}: RouterProviderProps): React.ReactElement {
    // Need to use a layout effect here so we are subscribed early enough to
    // pick up on any render-driven redirects/navigations (useEffect/<Navigate>)
    const [state, setStateImpl] = useState(router.state);
    const {v7_startTransition} = future || {};
    const setState = useCallback(
        (newState: RouterState) => {
            v7_startTransition
                ? startTransition(() => setStateImpl(newState))
                : setStateImpl(newState);
        },
        [setStateImpl, v7_startTransition],
    );
    useLayoutEffect(() => router.subscribe(setState), [router, setState]);

    const navigator = useMemo((): Navigator => {
        return {
            createHref: router.createHref.bind(router),
            encodeLocation: router.encodeLocation.bind(router),
            go: n => {
                // NOTE(calebmer): The Remix code we forked not await the `navigate()`
                // promises. We try to avoid calling these functions to navigate, instead using
                // our `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data
                // loading is done. Not when React has finished rendering.
                void router.navigate(n);
            },
            push: (to, state, opts) => {
                // NOTE(calebmer): The Remix code we forked not await the `navigate()`
                // promises. We try to avoid calling these functions to navigate, instead using
                // our `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data
                // loading is done. Not when React has finished rendering.
                void router.navigate(to, {
                    state,
                    preventScrollReset: opts?.preventScrollReset,
                });
            },
            replace: (to, state, opts) => {
                // NOTE(calebmer): The Remix code we forked not await the `navigate()`
                // promises. We try to avoid calling these functions to navigate, instead using
                // our `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data
                // loading is done. Not when React has finished rendering.
                void router.navigate(to, {
                    replace: true,
                    state,
                    preventScrollReset: opts?.preventScrollReset,
                });
            },
        };
    }, [router]);

    const basename = router.basename || "/";

    const dataRouterContext = useMemo(
        () => ({
            router,
            navigator,
            static: false,
            basename,
        }),
        [router, navigator, basename],
    );

    return (
        <DataRouterContext.Provider value={dataRouterContext}>
            <DataRouterStateContext.Provider value={state}>
                <Router
                    basename={basename}
                    location={state.location}
                    navigationType={state.historyAction}
                    navigator={navigator}
                >
                    {state.initialized ? (
                        <DataRoutes routes={router.routes} state={state} />
                    ) : (
                        fallbackElement
                    )}
                </Router>
            </DataRouterStateContext.Provider>
        </DataRouterContext.Provider>
    );
}

function DataRoutes({
    routes,
    state,
}: {
    routes: Array<DataRouteObject>;
    state: RouterState;
}): React.ReactElement | null {
    return useRoutesImpl(routes, undefined, state);
}
