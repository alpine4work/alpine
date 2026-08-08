import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";
import {Reaction, ReactionCharacter} from "~/shared/reactions/reaction.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {getAvatarDefaultDesign} from "~/shared/spaces/get_avatar_default_design.js";

type AccountAvatarDesignBase = {
    shouldShowRemovedAvatar: boolean;
    iconOverlayType: "bot" | "ghost" | null;
};

export type AccountImageAvatarDesign = AccountAvatarDesignBase & {
    type: "Image";
    content: Uint8Array;
};

export type AccountDefaultAvatarDesign = AccountAvatarDesignBase & {
    type: "Default";
    reaction: Reaction;
    backgroundColor: ThemeColor;
};

export type AccountAvatarDesign = AccountImageAvatarDesign | AccountDefaultAvatarDesign;

export type AccountModelDataForAvatarDesign = {
    readonly reactionCharacter: ReactionCharacter | null;
    readonly avatar: {readonly content: Uint8Array | null} | null;
    readonly space: {
        readonly state:
            | {readonly type: "Active"}
            | {readonly type: "Removed"}
            | {readonly type: "InvitePending"; readonly wasPreviouslyRemoved: boolean};
    };
} & (
    | {readonly botId: BotId; readonly id?: AccountId}
    // If `botId` is undefined then `id` is required since we need it to figure out the
    // avatar's default design.
    | {readonly botId?: BotId; readonly id: AccountId}
);

// Should be able to pass in `AccountModelData` for the `AccountAvatarData` type.
assertAssignableTypes<AccountModelData, AccountModelDataForAvatarDesign>();

export function getAccountAvatarDesign(
    accountData: AccountModelDataForAvatarDesign,
): AccountAvatarDesign {
    const imageContent = getImageContent(accountData);
    const shouldShowRemovedAvatar = wasAccountRemoved(accountData.space.state);
    const iconOverlayType = getAccountAvatarIconOverlayType(accountData, shouldShowRemovedAvatar);

    const designBase = {shouldShowRemovedAvatar, iconOverlayType} as const;

    return imageContent
        ? {type: "Image", content: imageContent, ...designBase}
        : {
              type: "Default",
              ...getAvatarDefaultDesign(
                  accountData.botId !== undefined
                      ? accountData.botId
                      : // `id` should always exist in this branch according to the type definition. Seems
                        // like TypeScript doesn't understand this.
                        accountData.id!,
                  accountData.reactionCharacter,
              ),
              ...designBase,
          };
}

export function getAccountFallbackDefaultAvatarDesign(
    accountData: AccountModelData,
): AccountDefaultAvatarDesign {
    const shouldShowRemovedAvatar = wasAccountRemoved(accountData.space.state);
    const iconOverlayType = getAccountAvatarIconOverlayType(accountData, shouldShowRemovedAvatar);

    return {
        type: "Default",
        ...getAvatarDefaultDesign(accountData.id, accountData.reactionCharacter),
        shouldShowRemovedAvatar,
        iconOverlayType,
    };
}

function getAccountAvatarIconOverlayType(
    accountData: AccountModelDataForAvatarDesign,
    shouldShowRemovedAvatar: boolean,
) {
    // If the account is a bot, we should ALWAYS show the bot icon, even if the bot
    // account was removed from the space.
    if (accountData.botId) {
        return "bot";
    }

    // If the account is a regular account and it was removed from the space, we should
    // show the ghost icon.
    if (shouldShowRemovedAvatar) {
        return "ghost";
    }

    return null;
}

function getImageContent(accountData: AccountModelDataForAvatarDesign) {
    if (!accountData.avatar?.content) {
        return null;
    }

    if (
        accountData.space.state.type === "InvitePending" &&
        !accountData.space.state.wasPreviouslyRemoved
    ) {
        // TODO(ifitzsimmons, #account-avatar-override): We should never get here. If the
        // account was never in the space and they've been invited, they should not have an
        // avatar. We should log a warning here to notify us of data loss / corruption
        return null;
    }

    return accountData.avatar.content;
}

function wasAccountRemoved(accountState: AccountModelDataForAvatarDesign["space"]["state"]) {
    // If the account is pending an invite and it was never a member of the space, we
    // should render the default account avatar (their initials with a themed
    // background) WITHOUT the removed account UX – they should appear active until
    // they reject the invite.
    return (
        accountState.type === "Removed" ||
        (accountState.type === "InvitePending" && accountState.wasPreviouslyRemoved)
    );
}
