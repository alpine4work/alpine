import {UserPlus} from "phosphor-react";
import {useMemo} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
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
    const navigate = useNavigate();
    const accountsStore = useAccountClientStore();
    const {space} = useSpaceContext();

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
                lastAvatar={
                    <IconButton
                        variant="quiet-darken"
                        size="base"
                        description="Invite"
                        pressErrorTitle="Couldn’t invite people to channel"
                        onPress={async () => {
                            // NOCOMMIT: Prefill invite message!
                            await navigate(`/s/${space.id}/chat/new?focus=picker`);
                        }}
                    >
                        <UserPlus size={spacing["4"]} />
                    </IconButton>
                }
            />
        </Box>
    );
}
