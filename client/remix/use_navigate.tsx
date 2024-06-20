import {Memo, ReactNode, createContext, useContext, useEffect, useMemo, useRef} from "react";
import {
    NavigateOptions,
    NavigateFunction as OriginalNavigateFunction,
    To,
    useLocation,
    // This is the file which implements our `useNavigate()` wrapper.
    // eslint-disable-next-line no-restricted-imports
    useNavigate as useOriginalNavigate,
} from "react-router-dom";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

/**
 * Function used to navigate to a different URL.
 *
 * The navigation function returns a `SafeFloatingPromise` which you may
 * optionally await. (The eslint rule `@typescript-eslint/no-floating-promises`
 * won't error if you don't await the result of the `navigate()` function.)
 *
 * This is because the promise returned by the navigate function will never
 * reject and we'll navigate to the route after
 * `delayScreenTransitionLoadingIndicatorLimitMs` and show a loading shimmer.
 * So there's always a built-in loading indicator for the navigate function.
 *
 * If you call `navigate()` some place that has built-in support for loading
 * indicators (e.g. an `<IconButton>`) we still recommend awaiting the promise.
 * To show an inline loading indicator before we show a full screen loading
 * indicator.
 */
export interface NavigateFunction {
    (to: To, options?: NavigateOptions & {stopPropagation?: boolean}): SafeFloatingPromise<void>;
    (delta: number): SafeFloatingPromise<void>;
}

export type OnNavigateFunction = (
    to: To,
    options?: NavigateOptions,
) => {stopPropagation?: boolean} & (
    | {preventDefault: false}
    | {preventDefault: true; promise: Promise<void>}
);

function unsupportedNavigateForTest(): never {
    throw new UnimplementedError(
        "Can't navigate in Jest unit tests without a `<Router>` component and a `<RootNavigationContextProvider>` component",
    );
}

function useOriginalNavigateWithJestFallback() {
    try {
        return useOriginalNavigate();
    } catch (error) {
        if (
            import.meta.jest &&
            error instanceof Error &&
            error.message.includes(
                "useNavigate() may be used only in the context of a <Router> component",
            )
        ) {
            return unsupportedNavigateForTest;
        }
        throw error;
    }
}

function createNavigateFunction(
    originalNavigate: OriginalNavigateFunction,
    waitForNextNavigation: (() => Promise<void>) | undefined,
    onNavigate: OnNavigateFunction | undefined,
) {
    return ((to: To | number, options?: NavigateOptions & {stopPropagation?: boolean}) => {
        if (waitForNextNavigation === undefined) return unsupportedNavigateForTest();

        if (typeof to === "number") {
            originalNavigate(to);
            return waitForNextNavigation();
        }

        if (!options?.stopPropagation) {
            const result = onNavigate?.(to, options);
            if (result?.preventDefault) return result.promise;
        }

        originalNavigate(to, options);
        return waitForNextNavigation();
    }) as NavigateFunction;
}

/**
 * A wrapper around [`useNavigate()` from React Router][1] that:
 *
 * - Doesn't throw when used in Jest unit tests
 * - Returns a promise that resolves when the navigation has completed
 * - Provides hooks for hijacking navigation (e.g. the peek stack wants to open
 *   up URLs in a peek)
 *
 * [1]: https://reactrouter.com/en/main/hooks/use-navigate
 */
export function useNavigate(): Memo<NavigateFunction> {
    // The navigation function changes when we're in a peek. Since a peek uses a
    // different `react-router` context.
    const originalNavigate = useOriginalNavigateWithJestFallback();

    const context = useContext(NavigationContext);

    // Throw if we don't have our parent context unless we're in tests. In unit
    // tests we allow the component to render but throw when you try to call the
    // navigate function.
    if (context === null && !import.meta.jest) {
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );
    }

    return useMemo(
        () =>
            createNavigateFunction(
                originalNavigate,
                context?.waitForNextNavigation,
                context?.onNavigate,
            ),
        [context, originalNavigate],
    );
}

/**
 * Use the root `navigate()` function. Ignores any
 * `<NavigationEventContextProvider>`s and `<PeekRemixEmbed>` navigation
 * listeners.
 */
export function useRootNavigate(): Memo<NavigateFunction> {
    const context = useContext(NavigationContext);

    // Throw if we don't have our parent context unless we're in tests. In unit
    // tests we allow the component to render but throw when you try to call the
    // navigate function.
    if (context === null && !import.meta.jest) {
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );
    }

    return useMemo(
        () =>
            createNavigateFunction(
                context?.rootOriginalNavigate ?? unsupportedNavigateForTest,
                context?.waitForNextNavigation,
                context?.onNavigate,
            ),
        [context],
    );
}

type NavigationContext = {
    readonly rootOriginalNavigate: OriginalNavigateFunction;
    readonly waitForNextNavigation: () => Promise<void>;
    readonly onNavigate: OnNavigateFunction | undefined;
};

const NavigationContext = createContext<NavigationContext | null>(null);

/**
 * Sets up the navigation context. Primarily resolves the promises returned by
 * `navigate()` by observing the `location` at the position of this context
 * provider in the tree. So should be rendered at the root of a react router
 * route (we render in `root.tsx` and `s.$spaceId.peek.tsx` since peeks create
 * their own react routers).
 */
export function NavigationContextProvider({children}: {children?: ReactNode}) {
    const parentContext = useContext(NavigationContext);
    const originalNavigate = useOriginalNavigate();
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

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
                    rootOriginalNavigate: parentContext?.rootOriginalNavigate ?? originalNavigate,
                    waitForNextNavigation,
                    onNavigate: parentContext?.onNavigate,
                }),
                [originalNavigate, parentContext, waitForNextNavigation],
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

        if (!result.preventDefault && !parentResult.preventDefault) {
            return parentResult;
        } else {
            return {
                stopPropagation: parentResult.stopPropagation,
                preventDefault: true,
                promise: runAllPromises([
                    result.preventDefault ? result.promise : null,
                    parentResult.preventDefault ? parentResult.promise : null,
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
