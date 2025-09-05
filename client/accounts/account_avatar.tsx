import {useMemo} from "react";
import {
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {RemovedAccountAvatar} from "~/client/accounts/removed_account_avatar.js";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {getAvatarThemeColors} from "~/shared/design/core/avatar_theme_colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {SpaceAccountStateType} from "~/shared/spaces/space_account_state.js";

// This component is rendered in hot paths (like `<TaskRowView>`) avoid using
// `<Box>` until we implement a transform that automatically inlines `<Box>`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

/**
 * A circular image representing the account.
 */
export function AccountAvatar({
    account,
    size,
    backgroundBorderWidth,
}: {
    account: AccountModel | AccountModelData;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    // This component is rendered in hot paths (like `<TaskRowView>`) avoid using
    // `sprinkles()` in the component's render function until we implement a
    // transform that automatically inlines `sprinkles()`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const accountData = useAccountModel(account);

    // IMPORTANT: If you update the HTML here you should also update
    // `renderAccountAvatar()` for code that needs to render avatars in
    // `<ContentEditor>`.
    if (!accountData.avatar?.content) {
        return (
            <DefaultAccountAvatar
                account={accountData}
                size={size}
                backgroundBorderWidth={backgroundBorderWidth}
            />
        );
    }

    if (
        accountData.space.state.type === "InvitePending" &&
        !accountData.space.state.wasPreviouslyRemoved
    ) {
        // TODO(ifitzsimmons, #account-avatar-override): We should never get here. If the account
        // was never in the space and they've been invited, they should not have an avatar.
        // We should log a warning here to notify us of data loss / corruption
        return (
            <DefaultAccountAvatar
                account={accountData}
                size={size}
                backgroundBorderWidth={backgroundBorderWidth}
            />
        );
    }
    return (
        <AccountAvatarWithImage
            accountStateType={accountData.space.state.type}
            content={accountData.avatar.content}
            size={size}
            backgroundBorderWidth={backgroundBorderWidth}
        />
    );
}

function DefaultAccountAvatar({
    account,
    size,
    backgroundBorderWidth,
}: {
    account: AccountModelData;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    const avatarColors = getAvatarThemeColors(account.id);

    const {firstInitial, lastInitial} = useMemo(() => getAccountAvatarInitials(account), [account]);
    const initialsText = useMemo(
        () => `${firstInitial}${lastInitial ?? ""}`,
        [firstInitial, lastInitial],
    );

    const avatarWithInitials = (
        <span
            className={accountAvatarInitialsClassName}
            style={{
                transform: `scale(${parseInt(size, 10) / 8})`,
                color: avatarColors.textColor,
            }}
            aria-hidden="true"
        >
            {initialsText.toUpperCase()}
        </span>
    );

    const accountState = account.space.state;

    // If the account is pending an invite and it was never a member of the space, we should render
    // the default account avatar (their initials with a themed background) WITHOUT the removed
    // account UX – they should appear active until they reject the invite.
    const shouldRenderRemovedAccountAvatar =
        accountState.type === "Removed" ||
        (accountState.type === "InvitePending" && accountState.wasPreviouslyRemoved);

    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                backgroundColor: avatarColors.backgroundColor,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            {shouldRenderRemovedAccountAvatar ? (
                <RemovedAccountAvatar size={size}>{avatarWithInitials}</RemovedAccountAvatar>
            ) : (
                avatarWithInitials
            )}
        </span>
    );
}

function AccountAvatarWithImage({
    content,
    size,
    backgroundBorderWidth,
    accountStateType,
}: {
    content: Uint8Array;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
    accountStateType: SpaceAccountStateType;
}) {
    const avatarImage = <AvatarImage content={content} borderRadius="full" />;
    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                position: "relative",
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            {accountStateType !== "Active" ? (
                <RemovedAccountAvatar size={size}>{avatarImage}</RemovedAccountAvatar>
            ) : (
                avatarImage
            )}
        </span>
    );
}
