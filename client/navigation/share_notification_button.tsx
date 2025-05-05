import {Memo, ReactElement, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {
    ShareNotificationOverlay,
    ShareNotificationOverlayRef,
} from "~/client/navigation/internal/share_notification_overlay.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export function ShareNotificationButton({
    excludeAccountId,
    onShare,
    children,
}: {
    excludeAccountId?: Memo<(accountId: AccountId) => boolean>;
    onShare: (notification: ShareNotification) => Promise<void>;
    children: ReactElement;
}) {
    const overlayRef = useRef<ShareNotificationOverlayRef>(null);

    return (
        <OverlayTriggerButton
            aria-haspopup="dialog"
            placement="bottom"
            offset="3"
            overlay={({isVisible, onCloseWithoutAnimation}) => (
                <Box paddingX="3">
                    <ShareNotificationOverlay
                        ref={overlayRef}
                        isVisible={isVisible}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                        excludeAccountId={excludeAccountId}
                        onShare={onShare}
                    />
                </Box>
            )}
            onOverlayEscapeGlobalKeyDown={event => {
                // If the focused element is a combobox input, `<MenuButton>`, or menu item
                // that's open and the user hits escape then we want the escape keydown to close
                // the focused element's overlay.
                if (
                    event.target instanceof HTMLElement &&
                    (event.target.getAttribute("aria-expanded") === "true" ||
                        event.target.role === "menuitem")
                ) {
                    return {allowDefault: true};
                }
            }}
            onOverlayTabGlobalKeyDown={() => {
                // Don't close the overlay when tab is pressed. Tab is needed to navigate
                // internally within the share overlay.
                return {allowDefault: true};
            }}
            onOverlayOutsidePress={() => {
                const overlay = assertExists(overlayRef.current);

                // If the share overlay's account grant input combobox is open and the user
                // clicks outside of the overlay, instead of closing the entire overlay just
                // close the combobox. A second click will close the overlay too.
                if (overlay.isAccountInputComboBoxOpen()) {
                    overlay.closeAccountInputComboBox();
                    return {preventDefault: true};
                }
            }}
        >
            {children}
        </OverlayTriggerButton>
    );
}
