import {useMemo} from "react";
import {
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {getAvatarThemeColors} from "~/shared/design/core/avatar_theme_colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

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

    return (
        <AccountAvatarWithImage
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
        </span>
    );
}

function AccountAvatarWithImage({
    content,
    size,
    backgroundBorderWidth,
}: {
    content: Uint8Array;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <AvatarImage content={content} />
        </span>
    );
}
