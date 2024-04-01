import {ReactNode, RefObject, createContext, useContext, useEffect, useRef, useState} from "react";
import {renderOverlayPortal, useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";

const OverlayWebMobileSpaceSinkContext = createContext<RefObject<HTMLDivElement> | null>(null);

export function OverlayMobileKeyboardSinkContextProvider({children}: {children?: ReactNode}) {
    const isMobile = useIsMobile();
    const {isNativeMobile} = useClientInfo();

    const portalRef = useRef<HTMLDivElement>(null);

    return (
        <OverlayWebMobileSpaceSinkContext.Provider
            value={isMobile && !isNativeMobile ? portalRef : null}
        >
            {children}
            {isMobile && !isNativeMobile ? renderOverlayPortal(portalRef) : null}
        </OverlayWebMobileSpaceSinkContext.Provider>
    );
}

/**
 * On mobile web (so excluding our mobile native apps) we have a portal element
 * inside the element which shrinks when the keyboard is open. That way we can
 * set `bottom: 0` and correctly position above the virtual keyboard.
 *
 * See `useMobileWebKitKeyboardSupport()` for more information.
 *
 * If we aren't on mobile web then this returns the root portal element.
 */
export function useOverlayMobileKeyboardPortalElement() {
    const rootPortalElement = useOverlayRootPortalElement();
    const portalRef = useContext(OverlayWebMobileSpaceSinkContext);

    const [keyboardPortalElement, setSpacePortalElement] = useState(portalRef?.current ?? null);

    useEffect(() => {
        setSpacePortalElement(portalRef?.current ?? null);
    }, [portalRef]);

    return keyboardPortalElement ?? rootPortalElement;
}
