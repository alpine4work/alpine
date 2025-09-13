import {useMemo} from "react";
import {
    AvatarData,
    AvatarImageData,
    AvatarInitialsData,
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
    getAvatarData,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {RemovedAccountAvatar} from "~/client/accounts/removed_account_avatar.js";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

// This component is rendered in hot paths (like `<TaskRowView>`) avoid using
// `<Box>` until we implement a transform that automatically inlines `<Box>`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

// IMPORTANT: If you update the HTML in this component you should also update
// `renderAccountAvatar()` for code that needs to render avatars in
// `<ContentEditor>`.
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
    const avatarData = getAvatarData(accountData);

    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                backgroundColor:
                    avatarData.type === "Initials" ? avatarData.backgroundColor : undefined,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <AccountAvatarInner accountData={accountData} size={size} avatarData={avatarData} />
        </span>
    );
}

function AccountAvatarInner({
    accountData,
    size,
    avatarData,
}: {
    accountData: AccountModelData;
    size: Spacing;
    avatarData: AvatarData;
}) {
    switch (avatarData.type) {
        case "Image":
            return <AccountAvatarWithImage size={size} avatarData={avatarData} />;
        case "Initials":
            return (
                <DefaultAccountAvatar account={accountData} size={size} avatarData={avatarData} />
            );
        default:
            throw exhaustive(avatarData);
    }
}

function DefaultAccountAvatar({
    account,
    size,
    avatarData,
}: {
    account: AccountModelData;
    size: Spacing;
    avatarData: AvatarInitialsData;
}) {
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
                color: avatarData.textColor,
            }}
            aria-hidden="true"
        >
            {initialsText.toUpperCase()}
        </span>
    );

    return avatarData.shouldShowRemovedAvatar ? (
        <RemovedAccountAvatar size={size}>{avatarWithInitials}</RemovedAccountAvatar>
    ) : (
        avatarWithInitials
    );
}

function AccountAvatarWithImage({size, avatarData}: {size: Spacing; avatarData: AvatarImageData}) {
    const avatarImage = <AvatarImage content={avatarData.content} borderRadius="full" />;
    return avatarData.shouldShowRemovedAvatar ? (
        <RemovedAccountAvatar size={size}>{avatarImage}</RemovedAccountAvatar>
    ) : (
        avatarImage
    );
}
