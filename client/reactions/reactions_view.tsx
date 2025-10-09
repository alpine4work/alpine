import {useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {ThumbsUpFill2Icon} from "~/client/icons/thumbs_up_fill2_icon.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {ReactionIcon} from "~/client/reactions/icons/reaction_icon.js";
import {colorSchemeVars, contentStyles} from "~/client/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ReactionsView({
    entityNoun,
    entityStartOfSentenceNoun = entityNoun.slice(0, 1).toUpperCase() + entityNoun.slice(1),
    reactions,
    accounts,
}: {
    entityNoun: string;
    entityStartOfSentenceNoun?: string;
    reactions: ReactionSet;
    accounts: ReadonlyArray<AccountModel>;
}) {
    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of accounts) accountById.set(account.id, account);
        return accountById;
    }, [accounts]);

    return (
        <SpaceRouteScrollView
            title={`${entityStartOfSentenceNoun} reactions`}
            titleJustifyContent="center"
            desktopMaxWidth={contentStyles.contentMaxWidth}
        >
            <Box
                maxWidth={contentStyles.contentMaxWidth}
                marginX="auto"
                paddingX={screenPaddingX}
                paddingBottom={navigationBarHeight}
            >
                {reactions.get().size === 0 ? (
                    <Box
                        fontSize="75"
                        height={navigationBarHeight}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        color="grey-70"
                        style={{
                            boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                        }}
                    >
                        This {entityNoun} doesn’t have any reactions yet
                    </Box>
                ) : (
                    Array.from(reactions.get(), ([accountId, reaction]) => {
                        const account = accountById.get(accountId) ?? AccountModel.getUnknown();

                        return (
                            <ReactionsViewReaction
                                key={accountId}
                                account={account}
                                reaction={reaction}
                            />
                        );
                    })
                )}
            </Box>
        </SpaceRouteScrollView>
    );
}

function ReactionsViewReaction({
    account,
    reaction,
}: {
    account: AccountModel;
    reaction: Reaction | "GenericLike";
}) {
    const accountData = useAccountModel(account);

    return (
        <Box
            display="flex"
            alignItems="center"
            gap="4"
            paddingY="3"
            style={{
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box flexShrink="0" display="flex" alignItems="center" gap="3">
                <AccountAvatar account={accountData} size="8" />
                <Box fontSize="100" fontStyle="truncate-semi-bold" userSelect="text">
                    {accountData.name}
                </Box>
            </Box>
            <Box flexGrow="1" />
            <Box
                flexShrink="0"
                width="8"
                height="8"
                display="flex"
                alignItems="center"
                justifyContent="center"
            >
                {reaction === "GenericLike" ? (
                    <ThumbsUpFill2Icon
                        size={spacing["5"]}
                        color={colorSchemeVars["theme-50-const"]}
                    />
                ) : (
                    <Box position="relative" top="-0.5">
                        <ReactionIcon reaction={reaction} size="8" />
                    </Box>
                )}
            </Box>
        </Box>
    );
}
