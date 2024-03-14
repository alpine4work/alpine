import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {mobileMaxScreenWidth, mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const IsMobileContext = createContext<boolean | null>(null);
const CanPrimaryInputHoverContext = createContext<boolean | null>(null);

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

/**
 * Can the user's primary input mechanism hover?
 *
 * Uses the CSS media query `(hover: none)`. When server rendering we use the
 * same value as `isMobile` then update on initial client render.
 */
export function useCanPrimaryInputHover(): boolean {
    const canPrimaryInputHover = useContext(CanPrimaryInputHoverContext);

    if (canPrimaryInputHover === null) {
        // In unit tests, pretend like we are not in mobile mode.
        if (import.meta.jest) return true;

        throw new InternalError("Must be rendered in an `<IsMobileContextProvider>`");
    }

    return canPrimaryInputHover;
}

/**
 * Is this a mobile context? Doesn't listen for changes. Prefer `useIsMobile()`
 * when possible. Definitely don't use this in React render methods.
 *
 * May also return a different value then what's in React context on the
 * initial server-side render.
 */
export function getIsMobileWithoutListening(): boolean {
    return !!NativeMobileBridge || window.matchMedia(mobilePlatformMediaQuery).matches;
}

export function IsMobileContextProvider({children}: {children?: ReactNode}) {
    const {screenWidth, isNativeMobile} = useClientInfo();
    const [isMobile, setIsMobile] = useState(isNativeMobile || screenWidth <= mobileMaxScreenWidth);

    useEffect(() => {
        const mediaQuery = window.matchMedia(mobilePlatformMediaQuery);

        const update = () => {
            runWithImmediatePriority(() => {
                setIsMobile(isNativeMobile || mediaQuery.matches);
            });
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQuery.addEventListener("change", update);
        return () => {
            mediaQuery.removeEventListener("change", update);
        };
    }, [isNativeMobile]);

    const [canPrimaryInputHover, setCanPrimaryInputHover] = useState(!isMobile);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(hover: none)");

        const update = () => {
            setCanPrimaryInputHover(!mediaQuery.matches);
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQuery.addEventListener("change", update);
        return () => {
            mediaQuery.removeEventListener("change", update);
        };
    }, [isNativeMobile]);

    return (
        <IsMobileContext.Provider value={isMobile}>
            <CanPrimaryInputHoverContext.Provider value={canPrimaryInputHover}>
                {children}
            </CanPrimaryInputHoverContext.Provider>
        </IsMobileContext.Provider>
    );
}

export function TestIsMobileContextProvider({
    isMobile,
    children,
}: {
    isMobile: boolean;
    children?: ReactNode;
}) {
    // Can only use in tests
    assert(import.meta.jest);

    // Must not have a parent context provider
    assert(useContext(IsMobileContext) === null);

    return <IsMobileContext.Provider value={isMobile}>{children}</IsMobileContext.Provider>;
}
