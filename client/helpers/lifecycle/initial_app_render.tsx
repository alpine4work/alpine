import {AppInitialRenderContext} from "@react-aria/ssr";
import {ReactElement, ReactNode, useContext, useEffect, useState} from "react";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Id, generateId} from "~/shared/id/id.js";

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
    const initialAppRender = useContext(AppInitialRenderContext);

    if (initialAppRender === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<AppInitialRenderContextProvider>` is explicitly used.
        if (import.meta.jest) return false;

        throw new InternalError("Must be rendered in an `<AppInitialRenderContextProvider>`");
    }

    return initialAppRender !== false;
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
    const initialAppRender = useContext(AppInitialRenderContext);

    if (initialAppRender === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `useAppInitialRenderContextProvider()` is explicitly used.
        if (import.meta.jest) return null;

        throw new InternalError("Must be rendered in an `useAppInitialRenderContextProvider()`");
    }

    return initialAppRender !== false ? (initialAppRender.id as Id) : null;
}

/**
 * If this is the initial app render then returns the initial app render time.
 * This is useful if you need a time that's shared across the client and
 * server so you don't have hydration issues.
 *
 * If non-null it's the initial app render. If null it's not the initial app
 * render.
 */
export function useInitialAppRenderTime(): Date | null {
    const initialAppRender = useContext(AppInitialRenderContext);

    if (initialAppRender === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `useAppInitialRenderContextProvider()` is explicitly used.
        if (import.meta.jest) return null;

        throw new InternalError("Must be rendered in an `useAppInitialRenderContextProvider()`");
    }

    return initialAppRender !== false ? initialAppRender.time : null;
}

let isInitialAppRender = true;

/**
 * Is this the initial render of our application? Generally you should prefer
 * using `useIsInitialAppRender()` since your component will re-render when
 * it's no longer the initial app render but if it's useful to know whether
 * we're either on the server or on the client in the initial app render
 * outside of React code then you may call this.
 *
 * Always returns true on the server. Returns true on the client during React's
 * initial hydration then switches to false once the app is ready to go.
 *
 * This function implies that initial app render is global state. There can't
 * be two separate React apps in the same realm with independent initial render
 * states. Since the server can't run React effects the server is always in
 * initial render mode.
 */
export function getIsInitialAppRenderWithoutListening(): boolean {
    return isInitialAppRender;
}

export function useAppInitialRenderContextProvider(
    initialAppRenderTime: Date,
    initialAppRenderId: Id | undefined,
    children: ReactNode,
): ReactElement {
    // There should only be one `<AppInitialRenderContextProvider>` at the root of
    // our application. Don't nest these!
    const parentIsInitialAppRender = useContext(AppInitialRenderContext);
    assert(parentIsInitialAppRender === null);

    const [initialAppRender, setInitialAppRender] = useState<{time: Date; id: Id} | false>(() => ({
        time: initialAppRenderTime,
        id: initialAppRenderId ?? generateId(),
    }));

    useEffect(() => {
        assert(typeof window !== "undefined" && isInitialAppRender);
        isInitialAppRender = false;

        setInitialAppRender(false);
    }, []);

    return (
        <AppInitialRenderContext.Provider value={initialAppRender}>
            {children}
        </AppInitialRenderContext.Provider>
    );
}
