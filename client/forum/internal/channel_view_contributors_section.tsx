import {useMemo} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useStore} from "~/client/helpers/use_store.js";
import {
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    renderedMaxChannelTopContributorCount,
} from "~/shared/forum/channel_model.js";
import {getChannelContributors} from "~/shared/rpc/forum_rpc_definitions.js";
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
                    Contributors
                </h3>
            )}
            <AccountAvatarPile
                size="7"
                topPreviewAccount="First"
                previewAccounts={useStore(
                    useMemo(() => {
                        return Store.mapMany(
                            (contributors?.topContributors ?? [AccountModel.getUnknown()]).map(
                                account => accountsStore.getAccountStore(account),
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
                )}
                accountCount={contributors?.contributorCount ?? 1}
                getAllAccounts={async limit => {
                    const {contributors} = await getChannelContributors(context, {
                        channelId: channel.id,
                        limit,
                    });

                    return (
                        Array.from(contributors)
                            // If we have any removed accounts then sort them to the end of the array.
                            // Prefer showing accounts that are still a part of the space.
                            .sort((account1, account2) => {
                                if (account1.initialData.space.wasRemoved) return -1;
                                if (account2.initialData.space.wasRemoved) return 1;
                                return 0;
                            })
                    );
                }}
            />
        </Box>
    );
}
