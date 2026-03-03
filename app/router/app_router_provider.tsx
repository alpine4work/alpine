import {Action, Router as RemixRouter, RouterState, RouterSubscriber} from "@remix-run/router";
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
import {flushSync} from "react-dom";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    Navigator,
    Router,
    RouterProviderProps,
    UNSAFE_useRoutesImpl as useRoutesImpl,
} from "react-router";
import {UNSAFE_FetchersContext as FetchersContext} from "react-router-dom";
import {getLocationNativeMobileTab} from "~/app/router/native_mobile_router.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * This is a fork of the [`<RouterProvider>` component in `react-router`][1].
 *
 * We forked this component to add support for our native mobile router. We've also
 * simplified some some bits we don't need.
 *
 * [1]:
 *     https://github.com/remix-run/react-router/blob/7759e8e2912eb69f6dd63b2906490831a2154cfd/packages/react-router-dom/index.tsx#L477-L743
 */
export function AppRouterProvider({
    fallbackElement,
    router,
    future,
}: RouterProviderProps): React.ReactElement {
    // In our native mobile app, we send a ping every 500ms to native to let it know
    // our React component is still up and running. If React crashes we want to let the
    // user know and show them an error message.
    useEffect(() => {
        if (!NativeMobileBridge) return;

        // Immediately send an initial ping instead of waiting for 500ms.
        NativeMobileBridge.health.ping();

        const interval = createInterval(() => {
            NativeMobileBridge!.health.ping();
        }, 500);

        return () => {
            interval.clear();
        };
    }, []);

    // Need to use a layout effect here so we are subscribed early enough to pick up on
    // any render-driven redirects/navigations (useEffect/<Navigate>)
    const [state, setStateImpl] = useState(router.state);
    const fetcherData = useRef<Map<string, any>>(new Map());
    const {v7_startTransition} = future || {};

    const setState: RouterSubscriber = useCallback(
        (newState, {deletedFetchers, unstable_flushSync, unstable_viewTransitionOpts}) => {
            // NOTE(calebmer): We don't currently use Remix view transitions so don't include
            // them in our fork.
            if (unstable_viewTransitionOpts) {
                throw new UnimplementedError("`unstable_viewTransitionOpts` is not implemented");
            }

            deletedFetchers.forEach(key => fetcherData.current.delete(key));
            newState.fetchers.forEach((fetcher, key) => {
                if (fetcher.data !== undefined) {
                    fetcherData.current.set(key, fetcher.data);
                }
            });

            if (unstable_flushSync) {
                flushSync(() => setStateImpl(newState));
            } else if (v7_startTransition) {
                startTransition(() => setStateImpl(newState));
            } else {
                setStateImpl(newState);
            }
        },
        [setStateImpl, v7_startTransition],
    );
    useLayoutEffect(() => router.subscribe(setState), [router, setState]);

    useEffect(() => {
        if (fallbackElement != null && router.future.v7_partialHydration) {
            // eslint-disable-next-line no-console
            console.warn(
                "`<RouterProvider fallbackElement>` is deprecated when using " +
                    "`v7_partialHydration`, use a `HydrateFallback` component instead",
            );
        }
        // Only log this once on initial mount
        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const navigator = useMemo((): Navigator => {
        return {
            createHref: router.createHref.bind(router),
            encodeLocation: router.encodeLocation.bind(router),
            go: n => {
                // NOTE(calebmer): The Remix code we forked didn't await the `navigate()` promises.
                // We try to avoid calling these functions to navigate, instead using our
                // `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data loading
                // is done. Not when React has finished rendering.
                void router.navigate(n);
            },
            push: (to, state, opts) => {
                // NOTE(calebmer): The Remix code we forked didn't await the `navigate()` promises.
                // We try to avoid calling these functions to navigate, instead using our
                // `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data loading
                // is done. Not when React has finished rendering.
                void router.navigate(to, {
                    state,
                    preventScrollReset: opts?.preventScrollReset,
                });
            },
            replace: (to, state, opts) => {
                // NOTE(calebmer): The Remix code we forked didn't await the `navigate()` promises.
                // We try to avoid calling these functions to navigate, instead using our
                // `useNavigate()` hook which returns a promise.
                //
                // The promise here actually isn't that useful. Since it resolves once data loading
                // is done. Not when React has finished rendering.
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
    // Insertion effects run while React is constructing DOM nodes and before the DOM
    // nodes are added to our view. So the old content is painted on screen.
    useInsertionEffect(() => {
        if (lastLocationKeyForInsertionEffectRef.current === state.location.key) return;
        lastLocationKeyForInsertionEffectRef.current = state.location.key;

        if (state.historyAction === Action.Push) {
            if (state.location.state?.isTabSwitch) {
                NativeMobileBridge?.navigation.prepareSwitchTab(
                    getLocationNativeMobileTab(state.location),
                );
            } else {
                // TODO(calebmer): I'd like to add some performance instrumentation to find out how
                // much time we spend synchronously blocked. Ideally add it as a property to a
                // navigation span since the duration may be too small to justify its own span.
                NativeMobileBridge?.navigation.preparePush();
            }
        } else if (state.historyAction === Action.Pop) {
            if (state.location.state?.isTabSwitch) {
                NativeMobileBridge?.navigation.prepareSwitchTab(
                    getLocationNativeMobileTab(state.location),
                );
            } else if (state.location.state?.isNotFromExternal) {
                const url = new URL(router.createHref(state.location), window.location.href);

                NativeMobileBridge?.navigation.preparePop(url);
            } else {
                NativeMobileBridge?.navigation.prepareExternalPop();
            }
        } else if (state.historyAction === Action.Replace) {
            if (state.location.state?.withPushAnimation) {
                NativeMobileBridge?.navigation.prepareReplaceWithPushAnimation();
            }
        }
    }, [router, state.historyAction, state.location]);

    // 2. Run navigation animation after we paint our new screen
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastLocationKeyForLayoutEffectRef.current === state.location.key) return;
        lastLocationKeyForLayoutEffectRef.current = state.location.key;

        if (!NativeMobileBridge) return;

        // Double request animation frame to make absolutely certain the browser has
        // finished painting the new location. We've observed cases on iOS for the drag
        // from left to pop gesture where the animation finishes and the old route briefly
        // flashes before the new route renders. This is because the browser hasn't
        // finished rendering the correct route by the time we call
        // `NativeMobileBridge.navigation.externalPop()`.
        //
        // Double request animation frame guarantees we run some code after the browser's
        // next animation frame.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                assert(NativeMobileBridge);

                const url = new URL(router.createHref(state.location), window.location.href);

                if (state.historyAction === Action.Push) {
                    if (state.location.state?.isTabSwitch) {
                        NativeMobileBridge?.navigation.switchTab(
                            getLocationNativeMobileTab(state.location),
                            url,
                        );
                    } else {
                        NativeMobileBridge.navigation.push(url);
                    }
                } else if (state.historyAction === Action.Pop) {
                    if (state.location.state?.isTabSwitch) {
                        NativeMobileBridge?.navigation.switchTab(
                            getLocationNativeMobileTab(state.location),
                            url,
                        );
                    } else if (state.location.state?.isNotFromExternal) {
                        NativeMobileBridge.navigation.pop(url);
                    } else {
                        NativeMobileBridge.navigation.externalPop();
                    }
                } else if (state.historyAction === Action.Replace) {
                    if (state.location.state?.withPushAnimation) {
                        NativeMobileBridge?.navigation.replaceWithPushAnimation(url);
                    } else {
                        NativeMobileBridge.navigation.replace(url);
                    }
                }
            });
        });
    }, [router, state.historyAction, state.location, state.location.key]);

    return (
        <DataRouterContext.Provider value={dataRouterContext}>
            <DataRouterStateContext.Provider value={state}>
                <FetchersContext.Provider value={fetcherData.current}>
                    <Router
                        basename={basename}
                        location={state.location}
                        navigationType={state.historyAction}
                        navigator={navigator}
                        future={{
                            v7_relativeSplatPath: router.future.v7_relativeSplatPath,
                        }}
                    >
                        {state.initialized || router.future.v7_partialHydration ? (
                            <DataRoutes
                                routes={router.routes}
                                future={router.future}
                                state={state}
                            />
                        ) : (
                            fallbackElement
                        )}
                    </Router>
                </FetchersContext.Provider>
            </DataRouterStateContext.Provider>
        </DataRouterContext.Provider>
    );
}

function DataRoutes({
    routes,
    future,
    state,
}: {
    routes: Array<DataRouteObject>;
    future: RemixRouter["future"];
    state: RouterState;
}): React.ReactElement | null {
    return useRoutesImpl(routes, undefined, state, future);
}
