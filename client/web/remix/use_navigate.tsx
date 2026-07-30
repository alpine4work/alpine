/* eslint-disable react-refresh/only-export-components */

import {Location, Router} from "@remix-run/router";
import {
    ContextType,
    Memo,
    MutableRefObject,
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
} from "react";
import {
    UNSAFE_DataRouterContext as DataRouterContext,
    NavigateOptions,
    UNSAFE_RouteContext as RouteContext,
    To,
    useLocation,
} from "react-router-dom";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContextIfExists} from "~/client/web/spaces/context/space_context.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {voidSafeFloatingPromise} from "~/shared/helpers/async/void_safe_floating_promise.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

/**
 * Function used to navigate to a different URL.
 *
 * The navigation function returns a `SafeFloatingPromise` which you may optionally
 * await. (The eslint rule `@typescript-eslint/no-floating-promises` won't error if
 * you don't await the result of the `navigate()` function.)
 *
 * This is because the promise returned by the navigate function will never reject
 * and we'll navigate to the route after
 * `delayScreenTransitionLoadingIndicatorLimitMs` and show a loading shimmer. So
 * there's always a built-in loading indicator for the navigate function.
 *
 * If you call `navigate()` some place that has built-in support for loading
 * indicators (e.g. an `<IconButton>`) we still recommend awaiting the promise. To
 * show an inline loading indicator before we show a full screen loading indicator.
 *
 * We also provide a functional `navigate(location => newLocation)` API that's not
 * available in Remix which is useful in some contexts.
 */
export interface NavigateFunction {
    (to: To, options?: NavigateOptions & {stopPropagation?: boolean}): SafeFloatingPromise<void>;
    (delta: number): SafeFloatingPromise<void>;
    (updater: NavigateFunctionUpdater): SafeFloatingPromise<void>;
}

type NavigateFunctionUpdater = (
    location: Location,
) => To | number | [to: To, options?: NavigateOptions & {stopPropagation?: boolean}] | void;

export type OnNavigateFunction = (
    to: To,
    options?: NavigateOptions,
) =>
    | ({stopPropagation?: boolean} & (
          | {preventDefault: false}
          | {preventDefault: true; promise: Promise<void>}
      ))
    | void;

function unsupportedNavigateForTest(): never {
    throw new UnimplementedError(
        "Can\u2019t navigate in Jest unit tests without a `<Router>` component and a `<RootNavigationContextProvider>` component",
    );
}

// Originally forked from `react-router`'s `useNavigateStable()` hook and then we
// added our features on top:
// https://github.com/remix-run/react-router/blob/aef5c4a617756e6fcc493de17b4be9997a5a19c8/packages/react-router/lib/hooks.tsx#L1064-L1095
function createNavigateFunction(
    context: NavigationContext | null,
    {
        withoutPropagation = false,
        spaceId,
    }: {
        withoutPropagation?: boolean;
        spaceId: string | null;
    },
): NavigateFunction {
    return function navigate(
        to: To | number | NavigateFunctionUpdater,
        options?: NavigateOptions & {stopPropagation?: boolean},
    ): SafeFloatingPromise<void> {
        if (context === null) return unsupportedNavigateForTest();
        const headersWithSpaceId = spaceId
            ? {...options?.unstable_headers, "cyberworlds-space-id": spaceId}
            : options?.unstable_headers;
        const navigateOptions = {
            ...options,
            unstable_headers: headersWithSpaceId,
        };

        const {
            router,
            routeContextRef: {current: routeContext},
            waitForNextNavigation,
            onNavigate,
        } = context;

        if (typeof to === "function") {
            const result = to(router.state.location);
            if (!result) return voidSafeFloatingPromise;
            return Array.isArray(result) ? navigate(...result) : navigate(result);
        }

        if (typeof to === "number") {
            void router.navigate(to);
            return waitForNextNavigation() as SafeFloatingPromise<void>;
        }

        const routeId = assertExists(
            routeContext.matches[routeContext.matches.length - 1]?.route.id,
        );

        if (!withoutPropagation && !options?.stopPropagation) {
            const result = onNavigate?.(to, navigateOptions);
            if (result?.preventDefault) return result.promise as SafeFloatingPromise<void>;
        }

        void router.navigate(to, {fromRouteId: routeId, ...navigateOptions});
        return waitForNextNavigation() as SafeFloatingPromise<void>;
    };
}

/**
 * A wrapper around [`useNavigate()` from React Router][1] that:
 *
 * - Doesn't throw when used in Jest unit tests
 * - Returns a promise that resolves when the navigation has completed
 * - Provides hooks for hijacking navigation (e.g. the peek stack wants to open up
 *   URLs in a peek)
 *
 * [1]: https://reactrouter.com/en/main/hooks/use-navigate
 */
export function useNavigate(): Memo<NavigateFunction> {
    const context = useContext(NavigationContext);
    const spaceContext = useSpaceContextIfExists();

    // Throw if we don't have our parent context unless we're in tests. In unit tests
    // we allow the component to render but throw when you try to call the navigate
    // function.
    if (context === null && !import.meta.jest) {
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );
    }

    return useMemo(
        () => createNavigateFunction(context, {spaceId: spaceContext?.space.id ?? null}),
        [context, spaceContext?.space.id],
    );
}

/**
 * Use the root `navigate()` function. Ignores any
 * `<NavigationEventContextProvider>`s and `<PeekRemixEmbed>` navigation listeners.
 */
export function useRootNavigate(): Memo<NavigateFunction> {
    const context = useContext(NavigationContext);
    const spaceContext = useSpaceContextIfExists();

    // Throw if we don't have our parent context unless we're in tests. In unit tests
    // we allow the component to render but throw when you try to call the navigate
    // function.
    if (context === null && !import.meta.jest) {
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );
    }

    return useMemo(() => {
        let rootContext = context;
        while (rootContext?.parent) {
            rootContext = rootContext.parent;
        }

        return createNavigateFunction(
            rootContext,
            // Don't call `onNavigate`. The root navigation function skips any event handlers
            // added with `<NavigationEventContextProvider>`.
            {withoutPropagation: true, spaceId: spaceContext?.space.id ?? null},
        );
    }, [context, spaceContext?.space.id]);
}

type NavigationContext = {
    readonly parent: NavigationContext | null;
    readonly router: Router;
    readonly routeContextRef: MutableRefObject<ContextType<typeof RouteContext>>;
    readonly waitForNextNavigation: () => Promise<void>;
    readonly onNavigate: OnNavigateFunction | undefined;
};

const NavigationContext = createContext<NavigationContext | null>(null);

/**
 * Sets up the navigation context. Primarily resolves the promises returned by
 * `navigate()` by observing the `location` at the position of this context
 * provider in the tree. So should be rendered at the root of a react router route
 * (we render in `root.tsx` and `_space.peek.tsx` since peeks create their own
 * react routers).
 */
export function NavigationContextProvider({children}: {children?: ReactNode}) {
    const routeContext = useContext(RouteContext);
    assert(routeContext.isDataRoute);

    const router = assertExists(useContext(DataRouterContext)?.router);

    const routeContextRef = useRef(routeContext);
    useLayoutEffectWithoutServerSideWarning(() => {
        routeContextRef.current = routeContext;
    });

    const parentContext = useContext(NavigationContext);
    const location = useLocation();
    const isMounted = useIsMounted();

    const navigationPromiseResolversRef = useRef<
        Array<{
            lastLocationKey: string;
            promiseResolver: PromiseResolver<void>;
        }>
    >([]);

    useLayoutEffectWithoutServerSideWarning(() => {
        navigationPromiseResolversRef.current = navigationPromiseResolversRef.current.filter(
            navigationPromiseResolver => {
                // Once the location changes, we can resolve our promise...
                if (location.key !== navigationPromiseResolver.lastLocationKey) {
                    navigationPromiseResolver.promiseResolver.resolve();
                    return false;
                }

                return true;
            },
        );
    }, [location]);

    const waitForNextNavigation = useEvent((): Promise<void> => {
        // Resolve immediately if this component has since unmounted.
        if (!isMounted()) return Promise.resolve();

        const promiseResolver = createPromiseResolver();

        navigationPromiseResolversRef.current.push({
            lastLocationKey: location.key,
            promiseResolver,
        });

        return promiseResolver.promise;
    });

    // If this component unmounts then resolve any pending navigation promises. For
    // instance `navigate(-1)` in a peek will close the peek.
    useEffect(() => {
        return () => {
            if (!isMounted()) {
                navigationPromiseResolversRef.current =
                    navigationPromiseResolversRef.current.filter(navigationPromiseResolver => {
                        navigationPromiseResolver.promiseResolver.resolve();
                        return false;
                    });
            }
        };
    }, [isMounted]);

    return (
        <NavigationContext.Provider
            value={useMemo(
                () => ({
                    parent: parentContext,
                    router,
                    routeContextRef,
                    waitForNextNavigation,
                    onNavigate: parentContext?.onNavigate,
                }),
                [parentContext, router, waitForNextNavigation],
            )}
        >
            {children}
        </NavigationContext.Provider>
    );
}

/**
 * Context provider which allows you to handle navigation events with custom
 * behavior. For example, opening a peek instead of navigating to a new page.
 */
export function NavigationEventContextProvider({
    onNavigate: onNavigateFromProps,
    children,
}: {
    onNavigate: OnNavigateFunction;
    children?: ReactNode;
}) {
    const parentContext = useContext(NavigationContext);

    if (parentContext === null) {
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );
    }

    const onNavigate: OnNavigateFunction = useEvent((to, options) => {
        const result = onNavigateFromProps(to, options) ?? {preventDefault: false};
        if (result.stopPropagation) return result;

        if (!parentContext.onNavigate) return result;

        const parentResult = parentContext.onNavigate(to, options);

        if (!result.preventDefault && !parentResult?.preventDefault) {
            return parentResult;
        } else {
            return {
                stopPropagation: parentResult?.stopPropagation,
                preventDefault: true,
                promise: runAllPromises([
                    result.preventDefault ? result.promise : null,
                    parentResult?.preventDefault ? parentResult.promise : null,
                ]).then(() => {}),
            };
        }
    });

    return (
        <NavigationContext.Provider
            value={useMemo(() => ({...parentContext, onNavigate}), [onNavigate, parentContext])}
        >
            {children}
        </NavigationContext.Provider>
    );
}
