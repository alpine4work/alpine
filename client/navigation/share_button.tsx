import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {ShareOverlay} from "~/client/navigation/internal/share_overlay.js";
import {ShareSwitch} from "~/client/navigation/internal/share_switch.js";
import {useShareState} from "~/client/navigation/internal/use_share_state.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function ShareButton({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange: onAccessPolicyChangeWithoutValidations,
    isReadOnly: isReadOnlyProp,
    onCopyLink,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicy) => void;
    isReadOnly?: boolean;
    onCopyLink: () => MaybePromise<void>;
}) {
    // We need all accounts when the `<ShareOverlay>` is open so preload
    // them now.
    useExpensivelyPreloadAllSpaceAccounts();

    const {changeAccessPolicy, isReadOnly, overlayId, modals} = useShareState({
        entityNoun,
        accessPolicy,
        onAccessPolicyChangeWithoutValidations,
        isReadOnly: isReadOnlyProp,
    });

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            {modals}
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom"
                offset="3"
                overlay={({isVisible, onCloseWithoutAnimation}) => (
                    <Box paddingX="3">
                        <ShareOverlay
                            id={overlayId}
                            accessPolicy={accessPolicy}
                            onAccessPolicyChange={changeAccessPolicy}
                            isVisible={isVisible}
                            isReadOnly={isReadOnly}
                            onCopyLink={onCopyLink}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
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
            >
                <Button
                    height="6"
                    paddingX="2"
                    // Don't focus the button on press since pressing will open the overlay and
                    // should focus the overlay.
                    //
                    // TODO(calebmer): Find a way to automate this instead of setting this prop
                    // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                    withoutFocusOnPress={true}
                >
                    Share
                </Button>
            </OverlayTriggerButton>
            <ShareSwitch
                entityNoun={entityNoun}
                accessPolicy={accessPolicy}
                onAccessPolicyChange={changeAccessPolicy}
                isReadOnly={isReadOnly}
            />
        </Box>
    );
}
