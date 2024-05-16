import {injectUseIsSSRImplementation} from "@react-aria/ssr";
import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Id, generateId} from "~/shared/id/id.js";

const AppInitialRenderContext = createContext<Id | false | null>(null);

/**
 * Is this the initial render of our application?
 *
 * True on the server side render and true on our initial client side hydration
 * render. Then we re-render the application with false. Any client side
 * navigation will keep this value at false.
 *
 * Useful if you need a different DOM structure in the server side render, but
 * when the application mounts you want client side React to take over.
 */
export function useIsInitialAppRender(): boolean {
    const initialAppRenderId = useContext(AppInitialRenderContext);

    if (initialAppRenderId === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<AppInitialRenderContextProvider>` is explicitly used.
        if (import.meta.jest) return false;

        throw new InternalError("Must be rendered in an `<AppInitialRenderContextProvider>`");
    }

    return initialAppRenderId !== false;
}

/**
 * Get a unique `Id` for the initial app render during the initial app render.
 *
 * This `Id` is useful if you need to render something random in your React
 * component. Since with `StableRandom` you can use this to consistently render
 * the same thing on the server and on the client.
 *
 * If non-null it's the initial app render. If null it's not the initial app
 * render.
 *
 * For example, this is used by `<TaskGridViewVirtualizedList>` to generate the
 * initial ghost task IDs so that they're the same on the client and the
 * server. Since ghost task IDs are included in a `data-testid` property in the
 * DOM they need to be the same.
 */
export function useInitialAppRenderId(): Id | null {
    const initialAppRenderId = useContext(AppInitialRenderContext);

    if (initialAppRenderId === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<AppInitialRenderContextProvider>` is explicitly used.
        if (import.meta.jest) return null;

        throw new InternalError("Must be rendered in an `<AppInitialRenderContextProvider>`");
    }

    return initialAppRenderId !== false ? initialAppRenderId : null;
}

// Use our `useIsInitialAppRender()` hook as the implementation of `react-aria`'s
// `useIsSSR()` hook so we don't need to render `react-aria`'s SSR context.
injectUseIsSSRImplementation(useIsInitialAppRender);

export function AppInitialRenderContextProvider({
    initialAppRenderId: initialAppRenderIdProp,
    children,
}: {
    initialAppRenderId: Id | undefined;
    children: ReactNode;
}) {
    // There should only be one `<AppInitialRenderContextProvider>` at the root of
    // our application. Don't nest these!
    const parentIsInitialAppRender = useContext(AppInitialRenderContext);
    assert(parentIsInitialAppRender === null);

    const [initialAppRenderId, setInitialAppRenderId] = useState<Id | false>(
        () => initialAppRenderIdProp ?? generateId(),
    );

    useEffect(() => {
        setInitialAppRenderId(false);
    }, []);

    return (
        <AppInitialRenderContext.Provider value={initialAppRenderId}>
            {children}
        </AppInitialRenderContext.Provider>
    );
}
