import {getAvatarThemeColors} from "~/shared/design/core/avatar_theme_colors.js";
import {AccountModelData, AccountModelDataSpaceState} from "~/shared/spaces/account_model.js";

type AvatarDataBase = {
    shouldShowRemovedAvatar: boolean;
    iconOverlayType: "bot" | "ghost" | null;
};
export type AvatarImageData = AvatarDataBase & {
    type: "Image";
    content: Uint8Array;
};
export type AvatarInitialsData = AvatarDataBase & {
    type: "Initials";
    textColor: string;
    backgroundColor: string;
};
export type AvatarData = AvatarImageData | AvatarInitialsData;

export function getAvatarData(accountData: AccountModelData): AvatarData {
    const imageContent = getImageContent(accountData);
    const shouldShowRemovedAvatar = wasAccountRemoved(accountData.space.state);
    const iconOverlayType = getAvatarIconOverlayType(accountData, shouldShowRemovedAvatar);

    const avatarDataBase = {shouldShowRemovedAvatar, iconOverlayType} as const;

    return imageContent
        ? {type: "Image", content: imageContent, ...avatarDataBase}
        : {type: "Initials", ...getAvatarThemeColors(accountData.id), ...avatarDataBase};
}

function getAvatarIconOverlayType(accountData: AccountModelData, shouldShowRemovedAvatar: boolean) {
    // If the account is a bot, we should ALWAYS show the bot icon, even if the bot account was
    // removed from the space.
    if (accountData.botId) {
        return "bot";
    }

    // If the account is a regular account and it was removed from the space, we should show the
    // ghost icon.
    if (shouldShowRemovedAvatar) {
        return "ghost";
    }

    return null;
}

function getImageContent(accountData: AccountModelData) {
    if (!accountData.avatar?.content) {
        return null;
    }

    if (
        accountData.space.state.type === "InvitePending" &&
        !accountData.space.state.wasPreviouslyRemoved
    ) {
        // TODO(ifitzsimmons, #account-avatar-override): We should never get here. If the account
        // was never in the space and they've been invited, they should not have an avatar.
        // We should log a warning here to notify us of data loss / corruption
        return null;
    }

    return accountData.avatar.content;
}

function wasAccountRemoved(accountState: AccountModelDataSpaceState) {
    // If the account is pending an invite and it was never a member of the space, we should render
    // the default account avatar (their initials with a themed background) WITHOUT the removed
    // account UX – they should appear active until they reject the invite.
    return (
        accountState.type === "Removed" ||
        (accountState.type === "InvitePending" && accountState.wasPreviouslyRemoved)
    );
}
