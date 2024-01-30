import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {Box} from "~/client/design/box.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {mobileMaxScreenWidth, mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {InternalError} from "~/shared/error/error.js";

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
        if (import.meta.jest) return false;

        throw new InternalError("Must be rendered in an `<IsMobileContextProvider>`");
    }

    return isMobile;
}

export function IsMobileContextProvider({children}: {children?: ReactNode}) {
    const {screenWidth, isNativeMobile} = useClientInfo();
    const [isMobile, setIsMobile] = useState(isNativeMobile || screenWidth <= mobileMaxScreenWidth);

    useEffect(() => {
        const mediaQueryList = window.matchMedia(mobilePlatformMediaQuery);

        const update = () => {
            runWithImmediatePriority(() => {
                setIsMobile(isNativeMobile || mediaQueryList.matches);
            });
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQueryList.addEventListener("change", update);
        return () => {
            mediaQueryList.removeEventListener("change", update);
        };
    }, [isNativeMobile]);

    return (
        <IsMobileContext.Provider value={isMobile}>
            {children}
            {/* {isNativeMobile && (
                // NOCOMMIT: WIP
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    right="0"
                    display="flex"
                    flexDirection="column"
                    backgroundColor="grey-0"
                    style={{height: "var(--safe-area-inset-top)"}}
                    // Render over everything, including blocking overlays.
                    zIndex="80"
                />
            )} */}
        </IsMobileContext.Provider>
    );
}
