import {renderRemovedAccountAvatarHtml} from "~/client/accounts/removed_account_avatar_html.js";
import {
    backgroundColorVar,
    borderRadius as borderRadiusValues,
    sprinkles,
} from "~/client/styles/styles.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {getAvatarThemeColors} from "~/shared/design/core/avatar_theme_colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {AccountModelData, AccountModelDataSpaceState} from "~/shared/spaces/account_model.js";

export const accountAvatarClassName = sprinkles({
    flexShrink: "0",
    borderRadius: "full",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "grey-80-const",
    position: "relative",
    zIndex: "0",
});

export const accountAvatarInitialsClassName = sprinkles({
    display: "block",
    // These are default CSS styles but make sure we don't inherit other styles
    // when in a `navigation_bar.tsx` title for instance.
    fontSize: "50",
    fontStyle: "normal",
    userSelect: "none",
});

type AvatarDataBase = {
    shouldShowRemovedAvatar: boolean;
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

/**
 * Renders an account avatar to an `HtmlElementGenerator` object. For rendering
 * avatars in `<ContentEditor>` where we can't render React UI.
 */
export function renderAccountAvatar({
    accountData,
    size,
    backgroundBorderWidth,
    spacingScale,
}: {
    accountData: AccountModelData;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
    spacingScale: SpacingScale;
}): HtmlElementGenerator {
    // IMPORTANT: If you update the HTML here you should also update
    // `<AccountAvatar>` for code that render avatars in React.
    const avatarData = getAvatarData(accountData);
    const outerHtml = new HtmlElementGenerator("span");
    outerHtml.setAttribute("class", accountAvatarClassName);

    const outerStyle = {
        width: spacing[size],
        height: spacing[size],
        "background-color": avatarData.type === "Initials" ? avatarData.backgroundColor : undefined,
        "box-shadow":
            backgroundBorderWidth !== undefined
                ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                : undefined,
    };
    const outerStyleString = Object.entries(outerStyle)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${value}`)
        .join(";");

    outerHtml.setAttribute("style", outerStyleString);

    return renderAccountAvatarInner({accountData, size, avatarData, spacingScale, outerHtml});
}

function renderAccountAvatarInner({
    accountData,
    size,
    avatarData,
    spacingScale,
    outerHtml,
}: {
    accountData: AccountModelData;
    size: Spacing;
    avatarData: AvatarData;
    spacingScale: SpacingScale;
    outerHtml: HtmlElementGenerator;
}) {
    switch (avatarData.type) {
        case "Image":
            return renderAccountAvatarWithImage({
                avatarData,
                size,
                spacingScale,
                outerHtml,
            });
        case "Initials":
            return renderAccountAvatarWithInitials({
                accountData,
                size,
                spacingScale,
                avatarData,
                outerHtml,
            });
        default:
            throw exhaustive(avatarData);
    }
}

const imageUrlCache = new WeakMap<Uint8Array, string>();

function renderAccountAvatarWithImage({
    size,
    spacingScale,
    avatarData,
    outerHtml,
}: {
    avatarData: AvatarImageData;
    size: Spacing;
    spacingScale: SpacingScale;
    outerHtml: HtmlElementGenerator;
}) {
    const imageUrl = getOrSetDefaultMapValue(
        imageUrlCache,
        avatarData.content,
        () => `data:${avatarContentType};base64,${encodeBase64(avatarData.content)}`,
    );

    const innerHtml = outerHtml.appendChild(new HtmlElementGenerator("img"));
    innerHtml.setAttribute("src", imageUrl);
    const innerHtmlStyleString = [
        "width: 100%",
        "height: 100%",
        "object-fit: cover",
        "overflow: hidden",
        `border-radius: ${borderRadiusValues["full"]}`,
    ].join(";");
    innerHtml.setAttribute("style", innerHtmlStyleString);
    innerHtml.setAttribute("aria-hidden", "true");

    if (avatarData.shouldShowRemovedAvatar) {
        renderRemovedAccountAvatarHtml({
            size,
            spacingScale,
            outerHtml,
        });
    }

    return outerHtml;
}

function renderAccountAvatarWithInitials({
    accountData,
    size,
    spacingScale,
    outerHtml,
    avatarData,
}: {
    accountData: AccountModelData;
    size: Spacing;
    spacingScale: SpacingScale;
    outerHtml: HtmlElementGenerator;
    avatarData: AvatarInitialsData;
}) {
    const {firstInitial, lastInitial} = getAccountAvatarInitials(accountData);

    const innerHtml = outerHtml.appendChild(new HtmlElementGenerator("span"));

    innerHtml.setAttribute("class", accountAvatarInitialsClassName);
    innerHtml.setAttribute(
        "style",
        `transform: scale(${parseInt(size, 10) / 8}); color: ${avatarData.textColor}`,
    );
    innerHtml.setAttribute("aria-hidden", "true");

    innerHtml.appendChild(
        new HtmlTextGenerator(`${firstInitial.toUpperCase()}${lastInitial?.toUpperCase() ?? ""}`),
    );

    if (avatarData.shouldShowRemovedAvatar) {
        renderRemovedAccountAvatarHtml({
            size,
            spacingScale,
            outerHtml,
        });
    }

    return outerHtml;
}

export function getAccountAvatarInitials(accountData: AccountModelData) {
    // TODO(calebmer): If we ever support eastern name order of family name first
    // then given name, the initials should preserve that order. We shouldn't put
    // the given name initial first.
    const {givenName, familyName} = parseAccountNameAssumingWesternNameOrder(accountData.name);

    // We use iterators instead of indexing into the name because iterators give us
    // full Unicode unicode code points. This means grapheme clusters will be
    // split, but surrogate pairs will be preserved.
    //
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/@@iterator
    const firstInitial: string = iterateGraphemes(givenName).next().value;
    const lastInitial: string | null = familyName
        ? iterateGraphemes(familyName).next().value
        : null;

    return {firstInitial, lastInitial};
}

export function getAvatarData(accountData: AccountModelData): AvatarData {
    const imageContent = getImageContent(accountData);
    const shouldShowRemovedAvatar = wasAccountRemoved(accountData.space.state);
    return imageContent
        ? {type: "Image", content: imageContent, shouldShowRemovedAvatar}
        : {type: "Initials", shouldShowRemovedAvatar, ...getAvatarThemeColors(accountData.id)};
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
