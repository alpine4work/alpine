import {UserPlus} from "phosphor-react";
import {useCallback, useMemo, useState} from "react";
import {createAccessPolicyStore} from "~/client/web/access/create_access_policy_store.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {accountAvatarPileSizes} from "~/client/web/accounts/account_avatar_pile_size.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {channelAccessLevelText} from "~/client/web/forum/internal/channel_access_level_text.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {ShareNotificationButton} from "~/client/web/navigation/share_notification_button.js";
import {ShareNotificationMobileModal} from "~/client/web/navigation/share_notification_mobile_modal.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useIdlyPreloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSiteRegistry} from "~/client/web/sites/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/web/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    AccessLevel,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    renderedMaxChannelTopContributorCount,
} from "~/shared/forum/channel_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {sendChannelShareNotification} from "~/shared/rpc/forum_rpc_definitions.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function ChannelViewContributorsSection({
    channel,
    contributors,
    withoutTitle,
    onAddAccountGrantsToAccessPolicy,
}: {
    channel: ChannelModel;
    contributors: ChannelContributorsModel | null;
    withoutTitle?: boolean;
    onAddAccountGrantsToAccessPolicy: (event: {
        accountGrantById: ReadonlyMap<AccountId, {level: AccessLevel}>;
        notification: ShareNotification | null;
    }) => Promise<void>;
}) {
    const platform = usePlatform();
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const siteRegistry = useSiteRegistry();
    const accessPolicy = useStore(createAccessPolicyStore(channel.accessPolicy, siteRegistry));

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    // When we open the `<ShareNotificationOverlay>` we immediately focus the account
    // input. Preload the account list so we don't need to show a loading spinner after
    // focusing the account input.
    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, currentAccount ? {spaceId: space.id} : null);

    const [showShareMobileModal, setShowShareMobileModal] = useState(false);
    if (platform !== "mobile" && showShareMobileModal) setShowShareMobileModal(false);

    const previewAccounts = useStore(
        useMemo(() => {
            return Store.mapMany(
                (contributors?.topContributors ?? [AccountModel.getUnknown()]).map(account =>
                    accountRegistry.getAccountStore(account),
                ),
                accounts => {
                    return (
                        Array.from(accounts)
                            // Don't show removed accounts in the channel contributors
                            .filter(account => account.space.state.type === "Active")
                            .slice(0, renderedMaxChannelTopContributorCount)
                    );
                },
            );
        }, [accountRegistry, contributors?.topContributors]),
    );

    const previewAccountIds = useMemo(
        () => new Set(previewAccounts.map(({id}) => id)),
        [previewAccounts],
    );

    // Exclude previewed accounts from the share dialog. Since clearly those accounts
    // already know about the channel. We want the user to share with new people!
    const excludeAccountId = useCallback(
        (accountId: AccountId) => previewAccountIds.has(accountId),
        [previewAccountIds],
    );

    const handleShare = async ({
        accessLevel,
        ...notification
    }: ShareNotification & {accessLevel: AccessLevel}) => {
        assert(currentAccount);

        // If the user didn't change the access level then all we do is send a
        // notification. If the user did change the access level then we need to update the
        // channel's access policy with the new accounts.
        if (
            accessPolicy.defaultGrant &&
            hasAccessLevel(accessPolicy.defaultGrant.level, accessLevel)
        ) {
            await sendChannelShareNotification(context, {
                channelId: channel.id,
                notification,
            });
        } else {
            await onAddAccountGrantsToAccessPolicy({
                accountGrantById: new Map(
                    notification.accountIds.map(accountId => [accountId, {level: accessLevel}]),
                ),
                notification,
            });
        }
    };

    const accountAvatarSize = "7";

    return (
        <Box>
            {!withoutTitle && (
                <h3
                    className={sprinkles({
                        color: channelViewMetadataSectionTitleColor,
                        fontSize: channelViewMetadataSectionTitleFontSize,
                        marginBottom: channelViewMetadataSectionTitleMarginBottom,
                    })}
                >
                    People
                </h3>
            )}
            <AccountAvatarPile
                size={accountAvatarSize}
                topPreviewAccount="Last"
                previewAccounts={previewAccounts}
                lastAvatar={
                    // You can't invite people unless there's a default grant (so you can reliably send
                    // people a link) or you have manage access.
                    !accessPolicy.defaultGrant &&
                    !hasAccessLevel(accessLevel, "Manage") ? null : platform === "mobile" ? (
                        <IconButton
                            variant="quiet-darken"
                            size="base"
                            // This button doesn't look interactive enough on its own. So use a pointer cursor
                            // to make clear it's interactive.
                            cursor="pointer"
                            description="Invite"
                            onPress={() => setShowShareMobileModal(true)}
                        >
                            <UserPlus size={spacing["4"]} />
                        </IconButton>
                    ) : (
                        <ShareNotificationButton
                            accessLevelText={channelAccessLevelText}
                            accessPolicy={accessPolicy}
                            excludeAccountId={excludeAccountId}
                            overlayOffsetAlong={`-${
                                parseRemLength(
                                    accountAvatarPileSizes[accountAvatarSize].avatarOverlapWidth,
                                ) * previewAccounts.length
                            }rem`}
                            onShare={handleShare}
                        >
                            <IconButton
                                variant="quiet-darken"
                                size="base"
                                // This button doesn't look interactive enough on its own. So use a pointer cursor
                                // to make clear it's interactive.
                                cursor="pointer"
                                description="Invite"
                            >
                                <UserPlus size={spacing["4"]} />
                            </IconButton>
                        </ShareNotificationButton>
                    )
                }
            />
            {showShareMobileModal && (
                <MobileFullScreenModal onClose={() => setShowShareMobileModal(false)}>
                    {({onCloseWithAnimation}) => (
                        <ShareNotificationMobileModal
                            accessLevelText={channelAccessLevelText}
                            accessPolicy={accessPolicy}
                            onCloseWithAnimation={onCloseWithAnimation}
                            excludeAccountId={excludeAccountId}
                            onShare={handleShare}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}
