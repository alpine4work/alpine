import {RouterState} from "@remix-run/router";
import {
    startTransition,
    useCallback,
    useEffect,
    useInsertionEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Navigator,
    Router,
    RouterProviderProps,
    UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {createInterval} from "~/shared/helpers/async/interval.js";

/**
 * This is a fork of the [`<RouterProvider>` component in `react-router`][1].
 *
 * We forked this component to add support for our native mobile router. We've
 * also simplified some some bits we don't need.
 *
 * [1]: https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/react-router/lib/components.tsx#L89-L166
 */
export function AppRouterProvider({
    fallbackElement,
    router,
    future,
}: RouterProviderProps): React.ReactElement {
    // In our native mobile app, we send a ping every 500ms to native to let it
    // know our React component is still up and running. If React crashes we want
    // to let the user know and show them an error message.
    useEffect(() => {
        if (!NativeMobileBridge) return;

        const interval = createInterval(() => {
            NativeMobileBridge!.health.ping();
        }, 500);

        return () => {
            interval.clear();
        };
    }, []);

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

    const lastLocationKeyForInsertionEffectRef = useRef(state.location.key);
    const lastLocationKeyForLayoutEffectRef = useRef(state.location.key);

    // 1. Prepare navigation animation before we paint our new screen
    //
    // Insertion effects run while React is constructing DOM nodes and before the
    // DOM nodes are added to our view. So the old content is painted on screen.
    useInsertionEffect(() => {
        if (lastLocationKeyForInsertionEffectRef.current === state.location.key) return;
        lastLocationKeyForInsertionEffectRef.current = state.location.key;

        if (state.historyAction === "PUSH") {
            // TODO(calebmer): I'd like to add some performance instrumentation to find out
            // how much time we spend synchronously blocked. Ideally add it as a property
            // to a navigation span since the duration may be too small to justify its
            // own span.
            NativeMobileBridge?.navigation.preparePush();
        } else if (state.historyAction === "POP") {
            if (state.location.state?.isNotFromExternal) {
                NativeMobileBridge?.navigation.preparePop();
            }
        }
    }, [state.historyAction, state.location.key]);

    // 2. Run navigation animation after we paint our new screen
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastLocationKeyForLayoutEffectRef.current === state.location.key) return;
        lastLocationKeyForLayoutEffectRef.current = state.location.key;

        const url = new URL(router.createHref(state.location), window.location.href);

        if (state.historyAction === "PUSH") {
            NativeMobileBridge?.navigation.push(url);
        } else if (state.historyAction === "POP") {
            if (state.location.state?.isNotFromExternal) {
                NativeMobileBridge?.navigation.pop(url);
            } else {
                NativeMobileBridge?.navigation.finishExternalPop();
            }
        } else if (state.historyAction === "REPLACE") {
            // NOCOMMIT: Test that this works!
            NativeMobileBridge?.navigation.replace(url);
        }
    }, [router, state.historyAction, state.location, state.location.key]);

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
