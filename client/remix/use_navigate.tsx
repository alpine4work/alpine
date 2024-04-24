import {Memo, ReactNode, createContext, useCallback, useContext, useEffect, useRef} from "react";
import {
    NavigateOptions,
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

export interface NavigateFunction {
    (to: To, options?: NavigateOptions & {stopPropagation?: boolean}): Promise<void>;
    (delta: number): Promise<void>;
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
    const originalNavigate = useNavigateWithJestFallback();
    const waitForNextNavigation = useContext(WaitForNavigationContext);
    const onNavigate = useContext(NavigationEventContext);

    // Throw if we don't have our parent context unless we're in tests. In unit
    // tests we allow the component to render but throw when you try to call the
    // navigate function.
    if (waitForNextNavigation === null && !import.meta.jest)
        throw new InternalError(
            "Must render in a `<WaitForNavigationContext>` to use this navigation function",
        );

    // TODO(calebmer): The new `@remix-run/router` implementation returns a promise
    // from its `navigate()` function. Can we use that instead of watching the
    // transition here?
    const navigate = useCallback(
        (to: To | number, options?: NavigateOptions & {stopPropagation?: boolean}) => {
            if (waitForNextNavigation === null) return unsupportedNavigateForTest();

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
        },
        [onNavigate, originalNavigate, waitForNextNavigation],
    );

    return navigate as Memo<NavigateFunction>;
}

function useNavigateWithJestFallback() {
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

function unsupportedNavigateForTest(): never {
    throw new UnimplementedError(
        "Can't navigate in Jest unit tests without a `<Router>` component and a `<WaitForNavigationContext>` component",
    );
}

const WaitForNavigationContext = createContext<(() => Promise<void>) | null>(null);

export function WaitForNavigationContextProvider({children}: {children?: ReactNode}) {
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
        <WaitForNavigationContext.Provider value={waitForNextNavigation}>
            {children}
        </WaitForNavigationContext.Provider>
    );
}

const NavigationEventContext = createContext<Memo<
    (
        to: To,
        options?: NavigateOptions,
    ) => {stopPropagation?: boolean} & (
        | {preventDefault: false}
        | {preventDefault: true; promise: Promise<void>}
    )
> | null>(null);

/**
 * Context provider which allows you to handle navigation events with custom
 * behavior. For example, opening a peek instead of navigating to a new page.
 */
export function NavigationEventContextProvider({
    onNavigate,
    children,
}: {
    onNavigate: Memo<
        (
            to: To,
            options?: NavigateOptions,
        ) =>
            | ({stopPropagation?: boolean} & (
                  | {preventDefault: false}
                  | {preventDefault: true; promise: Promise<void>}
              ))
            | void
    >;
    children?: ReactNode;
}) {
    const parentOnNavigate = useContext(NavigationEventContext);

    return (
        <NavigationEventContext.Provider
            value={useCallback(
                (
                    to: To,
                    options?: NavigateOptions,
                ): {stopPropagation?: boolean} & (
                    | {preventDefault: false}
                    | {preventDefault: true; promise: Promise<void>}
                ) => {
                    const result = onNavigate(to, options) ?? {preventDefault: false};
                    if (result.stopPropagation) return result;

                    if (!parentOnNavigate) return result;

                    const parentResult = parentOnNavigate(to, options);

                    if (!result.preventDefault && !parentResult.preventDefault) {
                        return {
                            stopPropagation: parentResult.stopPropagation,
                            preventDefault: false,
                        };
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
                },
                [onNavigate, parentOnNavigate],
            )}
        >
            {children}
        </NavigationEventContext.Provider>
    );
}

const RootNavigationContext = createContext<Memo<NavigateFunction> | null>(null);

/**
 * Use the root `navigate()` function. Ignores any
 * `<NavigationEventContextProvider>`s and `<PeekRemixEmbed>` navigation
 * listeners.
 */
export function useRootNavigate(): Memo<NavigateFunction> {
    const navigate = useContext(RootNavigationContext);

    if (navigate === null && !import.meta.jest)
        throw new InternalError(
            "Must render in a `<RootNavigationContextProvider>` to use this navigation function",
        );

    return navigate ?? (unsupportedNavigateForTest as any as Memo<NavigateFunction>);
}

export function RootNavigationContextProvider({children}: {children?: ReactNode}) {
    if (useContext(RootNavigationContext))
        throw new InternalError("Can't nest `<RootNavigationContextProvider>` components");

    const navigate = useNavigate();
    return (
        <RootNavigationContext.Provider value={navigate}>{children}</RootNavigationContext.Provider>
    );
}
