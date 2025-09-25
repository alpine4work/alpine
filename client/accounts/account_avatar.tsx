import {useMemo} from "react";
import {
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {AvatarIconOverlay} from "~/client/accounts/internal/avatar_icon_overlay.js";
import {
    AvatarData,
    AvatarImageData,
    AvatarInitialsData,
    getAvatarData,
} from "~/client/accounts/internal/get_avatar_data.js";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {backgroundColorVar, borderRadius, colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
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
    const spacingScale = useSpacingScale();

    const avatarPx = convertRemLengthToPx(size, spacingScale);
    const avatarData = getAvatarData(accountData);

    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                borderRadius: borderRadius["full"],
                backgroundColor:
                    avatarData.type === "Initials" ? avatarData.backgroundColor : undefined,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <AccountAvatarInner accountData={accountData} size={size} avatarData={avatarData} />
            {avatarData.shouldShowRemovedAvatar && (
                <span
                    style={{
                        position: "absolute",
                        overflow: "hidden",
                        borderRadius: borderRadius["full"],
                        width: avatarPx,
                        height: avatarPx,
                        backgroundColor: colorSchemeVars["grey-0"],
                        opacity: 0.6,
                        pointerEvents: "none",
                    }}
                />
            )}
            {avatarData.iconOverlayType && (
                <AvatarIconOverlay
                    avatarPixelSize={avatarPx}
                    iconType={avatarData.iconOverlayType}
                />
            )}
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
            return <AccountAvatarWithImage avatarData={avatarData} />;
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

    return (
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
}

function AccountAvatarWithImage({avatarData}: {avatarData: AvatarImageData}) {
    return <AvatarImage content={avatarData.content} borderRadius="full" />;
}
