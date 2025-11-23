import {useContext} from "react";
import {MobileFullScreenModalContext} from "~/client/web/design/internal/mobile_full_screen_modal_context.js";

/**
 * Has a `<MobileFullScreenModal>` been rendered on top of us?
 */
export function useIsBehindMobileFullScreenModal(): boolean {
    const modalContext = useContext(MobileFullScreenModalContext);
    return (modalContext?.presentedCount ?? 0) > 0;
}
