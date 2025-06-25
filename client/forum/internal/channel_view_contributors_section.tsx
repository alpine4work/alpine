import {UserPlus} from "phosphor-react";
import {useCallback, useMemo, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {accountAvatarPileSizes} from "~/client/accounts/account_avatar_pile_size.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {channelAccessLevelText} from "~/client/forum/internal/channel_access_level_text.js";
import {useStore} from "~/client/helpers/use_store.js";
import {ShareNotificationButton} from "~/client/navigation/share_notification_button.js";
import {ShareNotificationMobileModal} from "~/client/navigation/share_notification_mobile_modal.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useIdlyPreloadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
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

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(channel.accessPolicy, currentAccount?.id),
        [channel.accessPolicy, currentAccount?.id],
    );

    // When we open the `<ShareNotificationOverlay>` we immediately focus the
    // account input. Preload the account list so we don't need to show a loading
    // spinner after focusing the account input.
    useIdlyPreloadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id});

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
                            // If we have any removed accounts then sort them to the end of the array.
                            // Prefer showing accounts that are still a part of the space.
                            .sort((account1, account2) => {
                                if (account1.space.wasRemoved) return -1;
                                if (account2.space.wasRemoved) return 1;
                                return 0;
                            })
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

    // Exclude previewed accounts from the share dialog. Since clearly those
    // accounts already know about the channel. We want the user to share with new
    // people!
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
        // notification. If the user did change the access level then we need to update
        // the channel's access policy with the new accounts.
        if (
            channel.accessPolicy.defaultGrant &&
            hasAccessLevel(channel.accessPolicy.defaultGrant.level, accessLevel)
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
                    // You can't invite people unless there's a default grant (so you can reliably
                    // send people a link) or you have manage access.
                    !channel.accessPolicy.defaultGrant &&
                    !hasAccessLevel(accessLevel, "Manage") ? null : platform === "mobile" ? (
                        <IconButton
                            variant="quiet-darken"
                            size="base"
                            // This button doesn't look interactive enough on its own. So use a pointer
                            // cursor to make clear it's interactive.
                            cursor="pointer"
                            description="Invite"
                            onPress={() => setShowShareMobileModal(true)}
                        >
                            <UserPlus size={spacing["4"]} />
                        </IconButton>
                    ) : (
                        <ShareNotificationButton
                            accessLevelText={channelAccessLevelText}
                            accessPolicy={channel.accessPolicy}
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
                                // This button doesn't look interactive enough on its own. So use a pointer
                                // cursor to make clear it's interactive.
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
                            accessPolicy={channel.accessPolicy}
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
