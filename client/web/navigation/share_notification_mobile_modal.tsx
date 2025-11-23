import {Memo, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {getDefaultShareOverlyAccountInputAccessLevel} from "~/client/web/navigation/internal/get_default_share_overlay_account_input_access_level.js";
import {ShareOverlayAccountBody} from "~/client/web/navigation/internal/share_overlay_account_body.js";
import {
    ShareOverlayAccountInput,
    ShareOverlayAccountInputRef,
} from "~/client/web/navigation/internal/share_overlay_account_input.js";
import {NavigationBarContent} from "~/client/web/navigation/navigation_bar_content.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    AccessLevel,
    AccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareNotificationMobileModal({
    accessLevelText,
    accessPolicy,
    excludeAccountId,
    onCloseWithAnimation,
    onShare,
}: {
    accessLevelText: Record<AccessLevel, string>;
    accessPolicy: AccessPolicy;
    excludeAccountId?: Memo<(accountId: AccountId) => boolean>;
    onCloseWithAnimation: () => void;
    onShare: (notification: ShareNotification & {accessLevel: AccessLevel}) => Promise<void>;
}) {
    const {space, currentAccount} = useSpaceContext();

    const accountInputRef = useRef<ShareOverlayAccountInputRef>(null);

    const allAccounts =
        useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output?.accounts ??
        emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allAccounts]);

    const [selectedAccounts, setSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(emptyArray);

    const currentAccountAccessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    const defaultAccessLevel = useMemo(
        () => getDefaultShareOverlyAccountInputAccessLevel(accessPolicy),
        [accessPolicy],
    );

    const [accessLevel, setAccessLevel] = useState<AccessLevel>(defaultAccessLevel);
    if (!hasAccessLevel(currentAccountAccessLevel, "Manage") && accessLevel !== defaultAccessLevel)
        setAccessLevel(defaultAccessLevel);

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        scheduleAfterNavigationAnimation(() => {
            accountInputRef.current?.focus();
        });
    }, []);

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            <Box flexShrink="0" height="safe-area-inset-top" />
            <NavigationBarContent title="Share" onMobileClose={() => onCloseWithAnimation()} />
            <Box flexShrink="0" paddingX={screenPaddingX}>
                <Box height="border" backgroundColor="grey-5" />
                <Spacer space="5" />
                <Box position="relative" zIndex="10">
                    <ShareOverlayAccountInput
                        ref={accountInputRef}
                        allAccounts={allAccounts}
                        accountById={accountById}
                        selectedAccounts={selectedAccounts}
                        onSelectedAccountsChange={setSelectedAccounts}
                        excludeAccountId={excludeAccountId}
                        accessLevel={
                            hasAccessLevel(currentAccountAccessLevel, "Manage")
                                ? {
                                      accessLevelText,
                                      accessLevel,
                                      minAccessLevel: accessPolicy.defaultGrant?.level,
                                      onAccessLevelChange: setAccessLevel,
                                      isAltKeyDown: false,
                                  }
                                : undefined
                        }
                    />
                </Box>
            </Box>
            <Box paddingX="3">
                <ShareOverlayAccountBody
                    selectedAccounts={selectedAccounts}
                    onShare={async notification => {
                        await onShare({...assertExists(notification), accessLevel});
                        onCloseWithAnimation();
                    }}
                />
            </Box>
            <Box flexShrink="0" style={{height: "var(--window-safe-area-inset-bottom, 0px)"}} />
        </Box>
    );
}
