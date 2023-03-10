import {useTransition} from "@remix-run/react";
import {Memo, ReactNode, createContext, useCallback, useContext, useRef} from "react";
import {
    Location,
    NavigateOptions,
    To,
    useLocation,
    // This is the file which implements our `useNavigate()` wrapper.
    // eslint-disable-next-line no-restricted-imports
    useNavigate as useOriginalNavigate,
} from "react-router-dom";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {CancelledError, InternalError, UnimplementedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";

export interface NavigateFunction {
    (to: To, options?: NavigateOptions): Promise<void>;
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
    if (waitForNextNavigation === null && typeof jest === "undefined")
        throw new InternalError(
            "Must render in a `<WaitForNavigationContext>` to use this navigation function",
        );

    const navigate = useCallback(
        (to: To | number, options?: NavigateOptions) => {
            if (waitForNextNavigation === null) return unsupportedNavigateForTest();

            if (typeof to === "number") {
                originalNavigate(to);
                return waitForNextNavigation();
            }

            const result = onNavigate?.(to, options);
            if (result?.preventDefault) return result.promise;

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
            typeof jest !== "undefined" &&
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

function unsupportedNavigateForTest() {
    throw new UnimplementedError(
        "Can't navigate in Jest unit tests without a `<Router>` component and a `<WaitForNavigationContext>` component",
    );
}

const WaitForNavigationContext = createContext<(() => Promise<void>) | null>(null);

export function WaitForNavigationContextProvider({children}: {children?: ReactNode}) {
    const transition = useTransition();
    const location = useLocation();

    const navigationPromiseResolversRef = useRef<
        Array<{
            location: Location | null;
            promiseResolver: PromiseResolver<void>;
        }>
    >([]);

    useLayoutEffectWithoutServerSideWarning(() => {
        navigationPromiseResolversRef.current = navigationPromiseResolversRef.current.filter(
            navigationPromiseResolver => {
                // If our navigation promise resolver doesn't have a location object yet
                // then we assume the first location object we see is the one it is
                // waiting for.
                if (!navigationPromiseResolver.location) {
                    if (transition.state === "loading") {
                        navigationPromiseResolver.location = transition.location;
                        return true;
                    }
                    // If the first navigation is not `loading` or `idle` then the navigation we
                    // were waiting for must have been cancelled. (Right now the only other state is
                    // `submitting` is in form submission.)
                    else if (transition.state !== "idle") {
                        navigationPromiseResolver.promiseResolver.reject(
                            new CancelledError("Navigation cancelled", {
                                displayMessage: errorDisplayMessage`You opened a different link.`,
                            }),
                        );
                        return false;
                    }
                } else {
                    // Yay! The location we were waiting for is now the app location. We can resolve
                    // our promise resolver.
                    if (location.key === navigationPromiseResolver.location.key) {
                        navigationPromiseResolver.promiseResolver.resolve();
                        return false;
                    }
                    // Oh no...there's a new transition with a different location. This means our
                    // navigation was cancelled.
                    else if (transition.location?.key !== navigationPromiseResolver.location.key) {
                        navigationPromiseResolver.promiseResolver.reject(
                            new CancelledError("Navigation cancelled", {
                                displayMessage: errorDisplayMessage`You opened a different link.`,
                            }),
                        );
                        return false;
                    }
                }

                return true;
            },
        );
    }, [location, transition.location, transition.state]);

    const waitForNextNavigation = useCallback((): Promise<void> => {
        const promiseResolver = createPromiseResolver();

        navigationPromiseResolversRef.current.push({
            location: null,
            promiseResolver,
        });

        return promiseResolver.promise;
    }, []);

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
    ) => {preventDefault: false} | {preventDefault: true; promise: Promise<void>}
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
        ) => {preventDefault: false} | {preventDefault: true; promise: Promise<void>}
    >;
    children?: ReactNode;
}) {
    const parentOnNavigate = useContext(NavigationEventContext);

    return (
        <NavigationEventContext.Provider
            value={useCallback(
                (to: To, options?: NavigateOptions) => {
                    const result = parentOnNavigate?.(to, options);
                    if (result?.preventDefault) return result;
                    return onNavigate(to, options);
                },
                [onNavigate, parentOnNavigate],
            )}
        >
            {children}
        </NavigationEventContext.Provider>
    );
}
