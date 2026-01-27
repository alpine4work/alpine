import {
    accountAvatarClassName,
    accountAvatarInnerClassName,
} from "~/client/web/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {AvatarIconOverlay} from "~/client/web/accounts/internal/avatar_icon_overlay.js";
import {AvatarDefault} from "~/client/web/avatar/avatar_default.js";
import {AvatarImage} from "~/client/web/avatar/avatar_image.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {colors} from "~/shared/design/core/colors.js";
import {ParsableRemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    AccountAvatarDesign,
    AccountImageAvatarDesign,
    AccountModelDataForAvatarDesign,
    getAccountAvatarDesign,
} from "~/shared/spaces/get_account_avatar_design.js";

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
    withoutDecoration,
}: {
    account: AccountModel | AccountModelDataForAvatarDesign;
    size: ParsableRemLength;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
    withoutDecoration?: boolean;
}) {
    // This component is rendered in hot paths (like `<TaskRowView>`) avoid using
    // `sprinkles()` in the component's render function until we implement a
    // transform that automatically inlines `sprinkles()`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const accountData: AccountModelDataForAvatarDesign = useAccountModel(account);
    const spacingScale = useSpacingScale();

    const avatarPx = convertRemLengthToPx(size, spacingScale);
    const avatarDesign = getAccountAvatarDesign(accountData);

    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: avatarPx,
                height: avatarPx,
            }}
        >
            <span
                className={accountAvatarInnerClassName}
                style={{
                    width: avatarPx,
                    height: avatarPx,
                    backgroundColor:
                        avatarDesign.type === "Default"
                            ? colors[`${avatarDesign.backgroundColor}-20`]
                            : undefined,
                    boxShadow:
                        backgroundBorderWidth !== undefined
                            ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                            : undefined,
                }}
            >
                <AccountAvatarDesignView size={size} avatarDesign={avatarDesign} />
                {!withoutDecoration && avatarDesign.shouldShowRemovedAvatar && (
                    <span
                        style={{
                            display: "block",
                            zIndex: "10",
                            position: "absolute",
                            inset: 0,
                            backgroundColor: colorSchemeVars["grey-0"],
                            opacity: 0.6,
                            pointerEvents: "none",
                        }}
                    />
                )}
            </span>
            {!withoutDecoration && avatarDesign.iconOverlayType && (
                <AvatarIconOverlay avatarPx={avatarPx} iconType={avatarDesign.iconOverlayType} />
            )}
        </span>
    );
}

function AccountAvatarDesignView({
    size,
    avatarDesign,
}: {
    size: ParsableRemLength;
    avatarDesign: AccountAvatarDesign;
}) {
    switch (avatarDesign.type) {
        case "Image": {
            return <AccountImageAvatarDesignView avatarDesign={avatarDesign} />;
        }
        case "Default": {
            return <AvatarDefault size={size} reaction={avatarDesign.reaction} />;
        }
        default:
            throw exhaustive(avatarDesign);
    }
}

function AccountImageAvatarDesignView({avatarDesign}: {avatarDesign: AccountImageAvatarDesign}) {
    return <AvatarImage content={avatarDesign.content} />;
}
