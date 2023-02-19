import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {useClientInfo} from "~/client/remix/client_info_context";
import {mobileMaxScreenWidth, mobilePlatformMediaQuery} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";

const IsMobileContext = createContext<boolean | null>(null);

/**
 * Is the component rendering in mobile mode?
 *
 * Be careful, due to server-side rendering this value may be slightly
 * out-of-sync with whether CSS thinks we are in mobile mode or not. After the
 * initial render this value will be correct. Since there is tearing potential,
 * make sure it's not too bad.
 */
export function useIsMobile(): boolean {
    const isMobile = useContext(IsMobileContext);

    if (isMobile === null) {
        // In unit tests, pretend like we are not in mobile mode.
        if (typeof jest !== "undefined") return false;

        throw new InternalError("Must be rendered in an `<IsMobileContextProvider>`");
    }

    return isMobile;
}

export function IsMobileContextProvider({children}: {children?: ReactNode}) {
    const {windowWidth} = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();

    const [isMobile, setIsMobile] = useState(() => {
        if (isInitialAppRender) {
            return windowWidth <= mobileMaxScreenWidth;
        } else {
            return window.matchMedia(mobilePlatformMediaQuery).matches;
        }
    });

    useEffect(() => {
        const mediaQueryList = window.matchMedia(mobilePlatformMediaQuery);

        const update = () => {
            runWithImmediatePriority(() => {
                setIsMobile(mediaQueryList.matches);
            });
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQueryList.addEventListener("change", update);
        return () => {
            mediaQueryList.removeEventListener("change", update);
        };
    }, []);

    return <IsMobileContext.Provider value={isMobile}>{children}</IsMobileContext.Provider>;
}
