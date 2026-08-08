import {AppInitialRenderContext} from "@react-aria/ssr";
import {ReactElement, ReactNode, useContext, useEffect, useRef, useState} from "react";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Id, generateId} from "~/shared/id/id.open_source.js";

let isInitialAppRenderForClient = true;
let wasInitialAppRenderForClient = true;

/**
 * If we're on the client you can check whether we're in the initial app render
 * with a global.
 */
export function getIsInitialAppRender(): boolean {
    assert(typeof window !== "undefined");
    if (import.meta.jest) return false;
    return isInitialAppRenderForClient;
}

/**
 * This will return true during the initial app render until React finishes
 * rendering the second render where `isInitialAppRender` is set to false. Useful
 * for code which needs to tell if it's running immediately after an initial app
 * render.
 */
export function getWasInitialAppRender(): boolean {
    assert(typeof window !== "undefined");
    if (import.meta.jest) return false;
    return wasInitialAppRenderForClient;
}

/**
 * Is this the initial render of our application?
 *
 * True on the server side render and true on our initial client side hydration
 * render. Then we re-render the application with false. Any client side navigation
 * will keep this value at false.
 *
 * Useful if you need a different DOM structure in the server side render, but when
 * the application mounts you want client side React to take over.
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
 * component. Since with `StableRandom` you can use this to consistently render the
 * same thing on the server and on the client.
 *
 * If non-null it's the initial app render. If null it's not the initial app
 * render.
 *
 * For example, this is used by `<TaskGridViewVirtualizedList>` to generate the
 * initial ghost task IDs so that they're the same on the client and the server.
 * Since ghost task IDs are included in a `data-testid` property in the DOM they
 * need to be the same.
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
 * If this is the initial app render then returns the initial app render time. This
 * is useful if you need a time that's shared across the client and server so you
 * don't have hydration issues.
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

export function useAppInitialRenderContextProvider(
    initialAppRenderTime: Date,
    initialAppRenderId: Id | undefined,
    children: ReactNode,
): ReactElement {
    // There should only be one `<AppInitialRenderContextProvider>` at the root of our
    // application. Don't nest these!
    const parentIsInitialAppRender = useContext(AppInitialRenderContext);
    assert(parentIsInitialAppRender === null);

    const [initialAppRender, setInitialAppRender] = useState<{time: Date; id: Id} | false>(() => ({
        time: initialAppRenderTime,
        id: initialAppRenderId ?? generateId(),
    }));

    const wasInitialAppRenderRef = useRef(true);

    useEffect(() => {
        isInitialAppRenderForClient = false;
        setInitialAppRender(false);
    }, []);

    useEffect(() => {
        if (wasInitialAppRenderRef.current && initialAppRender === false) {
            wasInitialAppRenderRef.current = false;
            wasInitialAppRenderForClient = false;
        }
    }, [initialAppRender]);

    // Useful for integration tests or other scripting to know when our JavaScript has
    // finished running, React has finished running, and the initial render is over (so
    // components like `<ContentEditor>` are ready).
    useDevConsoleTool("ready", () => initialAppRender === false);

    return (
        <AppInitialRenderContext.Provider value={initialAppRender}>
            {children}
        </AppInitialRenderContext.Provider>
    );
}
