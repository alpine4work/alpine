import {UserPlus} from "phosphor-react";
import {useCallback, useMemo} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useStore} from "~/client/helpers/use_store.js";
import {ShareNotificationButton} from "~/client/navigation/share_notification_button.js";
import {
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    renderedMaxChannelTopContributorCount,
} from "~/shared/forum/channel_model.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {sendChannelShareNotification} from "~/shared/rpc/forum_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function ChannelViewContributorsSection({
    channel,
    contributors,
    withoutTitle,
}: {
    channel: ChannelModel;
    contributors: ChannelContributorsModel | null;
    withoutTitle?: boolean;
}) {
    const context = useAppContext();
    const accountsStore = useAccountClientStore();

    const previewAccounts = useStore(
        useMemo(() => {
            return Store.mapMany(
                (contributors?.topContributors ?? [AccountModel.getUnknown()]).map(account =>
                    accountsStore.getAccountStore(account),
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
        }, [accountsStore, contributors?.topContributors]),
    );

    const previewAccountIds = useMemo(
        () => new Set(previewAccounts.map(({id}) => id)),
        [previewAccounts],
    );

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
                size="7"
                topPreviewAccount="Last"
                previewAccounts={previewAccounts}
                lastAvatar={
                    <ShareNotificationButton
                        // Exclude previewed accounts from the share dialog. Since clearly those
                        // accounts already know about the channel. We want the user to share with new
                        // people!
                        excludeAccountId={useCallback(
                            (accountId: AccountId) => previewAccountIds.has(accountId),
                            [previewAccountIds],
                        )}
                        onShare={async notification => {
                            // NOCOMMIT: Integration test?
                            await sendChannelShareNotification(context, {
                                channelId: channel.id,
                                notification,
                            });
                        }}
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
                }
            />
        </Box>
    );
}
