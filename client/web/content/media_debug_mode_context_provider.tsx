import {PropsWithChildren, useEffect} from "react";
import {
    MediaDebugModeContext,
    setMediaDebugModeEnabledForNonReact,
} from "~/client/web/content/media_debug_mode.js";

export function MediaDebugModeContextProvider({
    children,
    isEnabled,
}: PropsWithChildren<{isEnabled: boolean}>) {
    useEffect(() => {
        setMediaDebugModeEnabledForNonReact(isEnabled);
    }, [isEnabled]);

    return (
        <MediaDebugModeContext.Provider value={isEnabled}>
            {children}
        </MediaDebugModeContext.Provider>
    );
}
