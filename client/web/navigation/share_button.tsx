import {useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {defaultAccessLevelText} from "~/client/web/navigation/access_level_text.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {ShareOverlay, ShareOverlayRef} from "~/client/web/navigation/internal/share_overlay.js";
import {ShareSwitch} from "~/client/web/navigation/internal/share_switch.js";
import {useShareState} from "~/client/web/navigation/internal/use_share_state.js";
import {shareSwitchWidth} from "~/client/web/navigation/share_switch_base.js";
import {useIdlyPreloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyWithoutGenerations,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";

export function ShareButton({
    entityNoun,
    entityId,
    accessLevelText = defaultAccessLevelText,
    accessPolicy,
    inherited,
    onAccessPolicyChange: onAccessPolicyChangeWithoutValidations,
    isReadOnly: isReadOnlyProp,
    withoutEditAccessLevel,
    withHiddenCommentAccessLevel,
    onCopyLink,
}: {
    entityNoun: string;
    entityId: FileEntityId;
    accessLevelText?: Record<AccessLevel, string>;
    accessPolicy: AccessPolicy;
    inherited?: {
        accessPolicy: AccessPolicyWithoutGenerations;
        explanations: InheritedAccessPolicyExplanations;
    };
    onAccessPolicyChange: (
        // The `notification` argument comes first to make it harder for the
        // implementation of this function to ignore the `notification` argument.
        notification: ShareNotification | null,
        accessPolicy: AccessPolicy,
    ) => MaybePromise<void>;
    isReadOnly?: boolean;
    withoutEditAccessLevel?: boolean;
    withHiddenCommentAccessLevel?: boolean;
    onCopyLink: () => MaybePromise<void>;
}) {
    const {currentAccount, space} = useSpaceContext();

    const overlayRef = useRef<ShareOverlayRef>(null);

    // We need all accounts when the `<ShareOverlay>` is open so preload
    // them now.
    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, currentAccount ? {spaceId: space.id} : null);

    const {changeAccessPolicy, isReadOnly, modalOwnerId, modals} = useShareState({
        accessLevelText,
        entityNoun,
        accessPolicy,
        inherited,
        onAccessPolicyChangeWithoutValidations,
        isReadOnly: isReadOnlyProp,
    });

    const gap = "1.5";
    const overlayMarginX = "3";

    return (
        <Box display="flex" alignItems="center" gap={gap}>
            {modals}
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom-end"
                offset="3"
                offsetAlong={addRemLengths(shareSwitchWidth, gap, overlayMarginX)}
                overlay={({isVisible, onCloseWithoutAnimation}) => (
                    <Box paddingX={overlayMarginX}>
                        <ShareOverlay
                            ref={overlayRef}
                            id={modalOwnerId}
                            entityNoun={entityNoun}
                            entityId={entityId}
                            accessLevelText={accessLevelText}
                            accessPolicy={accessPolicy}
                            inherited={inherited}
                            onAccessPolicyChange={changeAccessPolicy}
                            isVisible={isVisible}
                            isReadOnly={isReadOnly}
                            withoutEditAccessLevel={withoutEditAccessLevel}
                            withHiddenCommentAccessLevel={withHiddenCommentAccessLevel}
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
                onOverlayOutsidePress={() => {
                    const overlay = assertExists(overlayRef.current);

                    // If the share overlay's account grant input combobox is open and the user
                    // clicks outside of the overlay, instead of closing the entire overlay just
                    // close the combobox. A second click will close the overlay too.
                    if (overlay.isAccountGrantInputComboBoxOpen()) {
                        overlay.closeAccountGrantInputComboBox();
                        return {preventDefault: true};
                    }
                }}
            >
                <Button
                    height="6"
                    paddingX="1.5"
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
                inherited={inherited}
                onAccessPolicyChange={changeAccessPolicy}
                isReadOnly={isReadOnly}
            />
        </Box>
    );
}
