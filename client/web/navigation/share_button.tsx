import {Ref, useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {useHintOracle} from "~/client/web/design/use_hint_oracle.js";
import {useElementWithRef} from "~/client/web/helpers/refs/use_element_with_ref.js";
import {defaultAccessLevelText} from "~/client/web/navigation/access_level_text.js";
import {allowShareOverlayEscapeGlobalKeyDownDefault} from "~/client/web/navigation/allow_share_overlay_escape_global_key_down_default.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {ShareOverlay, ShareOverlayRef} from "~/client/web/navigation/internal/share_overlay.js";
import {ShareSwitch} from "~/client/web/navigation/internal/share_switch.js";
import {useShareState} from "~/client/web/navigation/internal/use_share_state.js";
import {shareSwitchWidth} from "~/client/web/navigation/share_switch_base.js";
import {useIdlyPreloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {pingAnimationClassName} from "~/client/web/styles/styles.js";
import {
    AccessLevel,
    EffectiveAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";

const shareButtonGap = "1.5";
const shareButtonOverlayMarginX = "3";

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
    activationHint = null,
    onActivationHintHide,
}: {
    entityNoun: string;
    entityId?: FileEntityId;
    accessLevelText?: Record<AccessLevel, string>;
    accessPolicy: ResolvedAccessPolicyWithGenerations;
    inherited?: {
        accessPolicy: EffectiveAccessPolicy;
        explanations: InheritedAccessPolicyExplanations;
    };
    onAccessPolicyChange: (
        // The `notification` argument comes first to make it harder for the implementation
        // of this function to ignore the `notification` argument.
        notification: ShareNotification | null,
        accessPolicy: ResolvedAccessPolicyWithGenerations,
    ) => MaybePromise<void>;
    isReadOnly?: boolean;
    withoutEditAccessLevel?: boolean;
    withHiddenCommentAccessLevel?: boolean;
    onCopyLink: () => MaybePromise<void>;
    activationHint?: {willBeVisible: true; isVisible: boolean} | null;
    onActivationHintHide?: () => void;
}) {
    const {currentAccount, space} = useSpaceContext();

    const overlayRef = useRef<ShareOverlayRef>(null);

    // We need all accounts when the `<ShareOverlay>` is open so preload them now.
    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, currentAccount ? {spaceId: space.id} : null);

    const {changeAccessPolicy, isReadOnly, modalOwnerId, modals} = useShareState({
        accessLevelText,
        entityNoun,
        accessPolicy,
        inherited,
        onAccessPolicyChangeWithoutValidations,
        isReadOnly: isReadOnlyProp,
    });

    // If `activationHint` was ever non-null then `hadActivationHint` will be true. We
    // need to keep rendering the activation hint component to avoid
    // unmounting/remounting the share button on press.
    const [hadActivationHint, setHadActivationHint] = useState(!!activationHint);
    if (!hadActivationHint && !!activationHint) setHadActivationHint(true);

    return (
        <Box display="flex" alignItems="center" gap={shareButtonGap}>
            {modals}
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom-end"
                offset="3"
                offsetAlong={addRemLengths(
                    shareSwitchWidth,
                    shareButtonGap,
                    shareButtonOverlayMarginX,
                )}
                overlay={({isVisible, onCloseWithoutAnimation}) => (
                    <Box paddingX={shareButtonOverlayMarginX}>
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
                    if (allowShareOverlayEscapeGlobalKeyDownDefault(event)) {
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

                    // If the share overlay's account grant input combobox is open and the user clicks
                    // outside of the overlay, instead of closing the entire overlay just close the
                    // combobox. A second click will close the overlay too.
                    if (overlay.isAccountGrantInputComboBoxOpen()) {
                        overlay.closeAccountGrantInputComboBox();
                        return {preventDefault: true};
                    }
                }}
            >
                {({isVisible}) => {
                    // We need to keep rendering the activation hint component if `showActivationHint`
                    // was ever true to avoid unmounting/remounting the share button on press.
                    if (!hadActivationHint) {
                        return renderShareButton(false);
                    } else {
                        return (
                            <ShareButtonActivationHint
                                activationHint={activationHint}
                                onActivationHintHide={onActivationHintHide}
                                isOverlayVisible={isVisible}
                                entityNoun={entityNoun}
                            />
                        );
                    }
                }}
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

function renderShareButton(isActivationHintVisible: boolean) {
    return (
        <Button
            height="6"
            paddingX="1.5"
            isHovered={isActivationHintVisible}
            // Don't focus the button on press since pressing will open the overlay and should
            // focus the overlay.
            //
            // TODO(calebmer): Find a way to automate this instead of setting this prop
            // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
            withoutFocusOnPress={true}
        >
            Share
        </Button>
    );
}

function ShareButtonActivationHint({
    ref,
    activationHint,
    onActivationHintHide,
    isOverlayVisible,
    entityNoun,
}: {
    ref?: Ref<HTMLElement>;
    activationHint: {willBeVisible: true; isVisible: boolean} | null;
    onActivationHintHide: (() => void) | undefined;
    isOverlayVisible: boolean;
    entityNoun: string;
}) {
    // We still use the hint oracle to claim this hint even when `activationHint` is
    // null. So that when you open the share overlay we don't immediately show the
    // search education overlay. Instead you have to navigate back to home and then to
    // another page before the search education hint appears.
    const canBeVisible = useHintOracle("a0#ShareActivationHint");

    const isVisible: boolean = canBeVisible && !!activationHint?.isVisible && !isOverlayVisible;

    // Hide the activation hint once the share overlay becomes visible.
    const isOverlayVisibleRef = useRef(isOverlayVisible);
    useEffect(() => {
        if (isOverlayVisibleRef.current === isOverlayVisible) return;
        isOverlayVisibleRef.current = isOverlayVisible;

        if (!isOverlayVisible) return;

        onActivationHintHide?.();
    }, [isOverlayVisible, onActivationHintHide]);

    return (
        <OverlayAnimated
            isVisible={isVisible}
            disableAnimationOut
            placement="bottom-end"
            offset="2.5"
            offsetAlong={addRemLengths(shareSwitchWidth, shareButtonGap, "-6")}
            overlay={
                <Box
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    className={greyElevated2ClassName}
                    borderRadius="1.5"
                    paddingX="3"
                    paddingY="2"
                    display="flex"
                    alignItems="center"
                    gap="4"
                >
                    <Box fontSize="50">
                        Once you&#x2019;re done editing, open the share
                        <br />
                        menu to share your {entityNoun} with others
                    </Box>
                </Box>
            }
        >
            <Box position="relative" zIndex="0" width="fit-content">
                {isVisible && (
                    <Box position="absolute" zIndex="10" top="-1" left="-1" width="2" height="2">
                        <Box
                            className={pingAnimationClassName}
                            position="absolute"
                            inset="0"
                            borderRadius="full"
                            backgroundColor="theme-30-const"
                        />
                        <Box
                            position="absolute"
                            inset="0"
                            borderRadius="full"
                            backgroundColor="theme-40-const"
                        />
                    </Box>
                )}
                {useElementWithRef(renderShareButton(isVisible), ref ?? null)}
            </Box>
        </OverlayAnimated>
    );
}
