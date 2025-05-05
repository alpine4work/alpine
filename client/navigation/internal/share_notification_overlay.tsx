import {Memo, Ref, forwardRef, useImperativeHandle, useMemo, useRef, useState} from "react";
import {FocusScope} from "react-aria";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {ShareOverlayAccountGrantBody} from "~/client/navigation/internal/share_overlay_account_grant_body.js";
import {
    ShareOverlayAccountInput,
    ShareOverlayAccountInputRef,
} from "~/client/navigation/internal/share_overlay_account_input.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {backgroundColorVar, greyElevated1ClassName} from "~/client/styles/styles.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type ShareNotificationOverlayRef = {
    isAccountInputComboBoxOpen(): boolean;
    closeAccountInputComboBox(): void;
};

const ShareNotificationOverlayForwardRef = forwardRef(ShareNotificationOverlay);
export {ShareNotificationOverlayForwardRef as ShareNotificationOverlay};

function ShareNotificationOverlay(
    {
        isVisible,
        onCloseWithoutAnimation,
        excludeAccountId,
        onShare,
    }: {
        isVisible: boolean;
        onCloseWithoutAnimation: () => void;
        excludeAccountId?: Memo<(accountId: AccountId) => boolean>;
        onShare: (notification: ShareNotification) => Promise<void>;
    },
    ref: Ref<ShareNotificationOverlayRef>,
) {
    const {space} = useSpaceContext();

    const accountInputRef = useRef<ShareOverlayAccountInputRef>(null);

    const [selectedAccounts, setSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(emptyArray);

    useImperativeHandle(
        ref,
        () => ({
            isAccountInputComboBoxOpen: () => {
                return assertExists(accountInputRef.current).isComboBoxOpen();
            },
            closeAccountInputComboBox: () => {
                assertExists(accountInputRef.current).closeComboBox();
            },
        }),
        [],
    );

    const allAccounts =
        useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output?.accounts ??
        emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    return (
        <FocusScope
            // If we're animating closed then don't contain focus since we need to move
            // focus back to the overlay trigger button element.
            contain={isVisible}
        >
            <Box
                className={greyElevated1ClassName}
                position="relative"
                zIndex="0"
                backgroundColor="grey-0"
                borderRadius="2.5"
                boxShadow="elevation-20"
                paddingY="5"
                style={{
                    // Add just a little more width so it doesn't line up perfectly with other `96`
                    // spaced elements. For example, in channel views where `<ChannelViewAside>` has
                    // a width of `96` (see `postListViewAsideMaxWidth`).
                    width: addRemLengths(spacing["96"], spacing["4"]),
                }}
            >
                <OverlayScopeContextProvider
                // Make sure any overlays inside the share overlay are animated with the share
                // overlay.
                >
                    <Box position="relative" zIndex="10" paddingX="5">
                        <ShareOverlayAccountInput
                            ref={accountInputRef}
                            allAccounts={allAccounts}
                            accountById={accountById}
                            selectedAccounts={selectedAccounts}
                            onSelectedAccountsChange={setSelectedAccounts}
                            excludeAccountId={excludeAccountId}
                        />
                        <Box
                            position="absolute"
                            bottom="-1"
                            left="0"
                            right="0"
                            height="1"
                            style={{backgroundColor: backgroundColorVar}}
                        />
                        <Box
                            position="absolute"
                            bottom="-4"
                            left="0"
                            right="0"
                            height="3"
                            style={{
                                background: `linear-gradient(to bottom, ${backgroundColorVar}, transparent)`,
                            }}
                        />
                    </Box>
                    <ShareOverlayAccountGrantBody
                        willAlwaysNotifyPeople={true}
                        selectedAccounts={selectedAccounts}
                        onShare={async notification => {
                            await onShare(assertExists(notification));
                            onCloseWithoutAnimation();
                        }}
                    />
                </OverlayScopeContextProvider>
            </Box>
        </FocusScope>
    );
}
