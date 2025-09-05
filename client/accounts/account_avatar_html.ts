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
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {SpaceAccountStateType} from "~/shared/spaces/space_account_state.js";

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
    if (accountData.avatar?.content) {
        if (
            accountData.space.state.type === "InvitePending" &&
            !accountData.space.state.wasPreviouslyRemoved
        ) {
            // TODO(ifitzsimmons, #account-avatar-override): We should never get here. If the account
            // was never in the space and they've been invited, they should not have an avatar.
            // We should log a warning here to notify us of data loss / corruption
            return renderAccountAvatarWithInitials({
                accountData,
                size,
                backgroundBorderWidth,
                spacingScale,
            });
        }

        return renderAccountAvatarWithImage({
            content: accountData.avatar.content,
            size,
            spacingScale,
            accountState: accountData.space.state.type,
        });
    } else {
        return renderAccountAvatarWithInitials({
            accountData,
            size,
            backgroundBorderWidth,
            spacingScale,
        });
    }
}

const imageUrlCache = new WeakMap<Uint8Array, string>();

function renderAccountAvatarWithImage({
    content,
    size,
    spacingScale,
    accountState,
}: {
    content: Uint8Array;
    size: Spacing;
    spacingScale: SpacingScale;
    accountState: SpaceAccountStateType;
}) {
    const imageUrl = getOrSetDefaultMapValue(
        imageUrlCache,
        content,
        () => `data:${avatarContentType};base64,${encodeBase64(content)}`,
    );

    const outerHtml = new HtmlElementGenerator("span");
    outerHtml.setAttribute("class", accountAvatarClassName);

    const outerStyleString = [
        `width: ${spacing[size]}`,
        `height: ${spacing[size]}`,
        "position: relative",
    ].join(";");
    outerHtml.setAttribute("style", outerStyleString);

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

    if (accountState !== "Active") {
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
    backgroundBorderWidth,
    spacingScale,
}: {
    accountData: AccountModelData;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
    spacingScale: SpacingScale;
}) {
    const {firstInitial, lastInitial} = getAccountAvatarInitials(accountData);

    // Get themed background color for this account
    const {backgroundColor: avatarBackgroundColor, textColor: avatarTextColor} =
        getAvatarThemeColors(accountData.id);

    const outerHtml = new HtmlElementGenerator("span");
    outerHtml.setAttribute("class", accountAvatarClassName);

    let outerStyleString = `width: ${spacing[size]}; height: ${spacing[size]}; background-color: ${avatarBackgroundColor}`;

    if (backgroundBorderWidth !== undefined) {
        outerStyleString += `; box-shadow: 0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`;
    }

    outerHtml.setAttribute("style", outerStyleString);

    const innerHtml = outerHtml.appendChild(new HtmlElementGenerator("span"));

    innerHtml.setAttribute("class", accountAvatarInitialsClassName);
    innerHtml.setAttribute(
        "style",
        `transform: scale(${parseInt(size, 10) / 8}); color: ${avatarTextColor}`,
    );
    innerHtml.setAttribute("aria-hidden", "true");

    innerHtml.appendChild(
        new HtmlTextGenerator(`${firstInitial.toUpperCase()}${lastInitial?.toUpperCase() ?? ""}`),
    );

    // If the account is pending an invite and it was never a member of the space, we should render
    // the default account avatar (their initials with a themed background) WITHOUT the removed
    // account UX – they should appear active until they reject the invite.
    if (
        (accountData.space.state.type === "InvitePending" &&
            accountData.space.state.wasPreviouslyRemoved) ||
        accountData.space.state.type === "Removed"
    ) {
        renderRemovedAccountAvatarHtml({
            size,
            spacingScale,
            outerHtml,
        });
    }

    return outerHtml;
}
