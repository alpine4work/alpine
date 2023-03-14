import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";

const AppInitialRenderContext = createContext<boolean | null>(null);

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
    const isInitialAppRender = useContext(AppInitialRenderContext);

    if (isInitialAppRender === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<AppInitialRenderContextProvider>` is explicitly used.
        if (typeof jest !== "undefined") return false;

        throw new InternalError("Must be rendered in an `<AppInitialRenderContextProvider>`");
    }

    return isInitialAppRender;
}

export function AppInitialRenderContextProvider({children}: {children: ReactNode}) {
    // There should only be one `<AppInitialRenderContextProvider>` at the root of
    // our application. Don't nest these!
    const parentIsInitialAppRender = useContext(AppInitialRenderContext);
    assert(parentIsInitialAppRender === null);

    const [isInitialAppRender, setIsInitialAppRender] = useState(true);

    useEffect(() => {
        setIsInitialAppRender(false);
    }, []);

    return (
        <AppInitialRenderContext.Provider value={isInitialAppRender}>
            {children}
        </AppInitialRenderContext.Provider>
    );
}
