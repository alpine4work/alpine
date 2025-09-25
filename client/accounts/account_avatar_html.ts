import {renderAvatarIconOverlay} from "~/client/accounts/internal/avatar_icon_overlay_html.js";
import {
    AvatarData,
    AvatarImageData,
    AvatarInitialsData,
    getAvatarData,
} from "~/client/accounts/internal/get_avatar_data.js";
import {
    backgroundColorVar,
    borderRadius as borderRadiusValues,
    colorSchemeVars,
    sprinkles,
} from "~/client/styles/styles.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

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

// IMPORTANT: If you update the HTML here you should also update
// `<AccountAvatar>` for code that render avatars in React.
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
    const avatarData = getAvatarData(accountData);
    const avatarPx = convertRemLengthToPx(size, spacingScale);

    const outerHtml = new HtmlElementGenerator("span");
    outerHtml.setAttribute("class", accountAvatarClassName);

    const outerStyle = {
        width: spacing[size],
        height: spacing[size],
        borderRadius: borderRadiusValues["full"],
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

    outerHtml.appendChild(
        renderAccountAvatarInner({
            accountData,
            size,
            avatarData,
        }),
    );

    if (avatarData.shouldShowRemovedAvatar) {
        // All removed avatar will have a "greyed-out" effect applied.
        const avatarContentFilter = outerHtml.appendChild(new HtmlElementGenerator("span"));
        const avatarContentFilterStyleString = [
            "position: absolute",
            "overflow: hidden",
            `width: ${avatarPx}px`,
            `height: ${avatarPx}px`,
            `border-radius: ${borderRadiusValues["full"]}`,
            `background-color: ${colorSchemeVars["grey-0"]}`,
            "opacity: 0.6",
            "pointer-events: none",
        ].join(";");
        avatarContentFilter.setAttribute("style", avatarContentFilterStyleString);
    }

    if (avatarData.iconOverlayType) {
        const {iconCutout, iconOverlay} = renderAvatarIconOverlay({
            avatarPixelSize: avatarPx,
            iconType: avatarData.iconOverlayType,
        });
        outerHtml.appendChildren(iconCutout, iconOverlay);
    }

    return outerHtml;
}

function renderAccountAvatarInner({
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
            return renderAccountAvatarWithImage(avatarData);
        case "Initials":
            return renderAccountAvatarWithInitials({
                accountData,
                size,
                avatarData,
            });
        default:
            throw exhaustive(avatarData);
    }
}

const imageUrlCache = new WeakMap<Uint8Array, string>();

function renderAccountAvatarWithImage(avatarData: AvatarImageData) {
    const imageUrl = getOrSetDefaultMapValue(
        imageUrlCache,
        avatarData.content,
        () => `data:${avatarContentType};base64,${encodeBase64(avatarData.content)}`,
    );

    const avatarHtml = new HtmlElementGenerator("img");
    avatarHtml.setAttribute("src", imageUrl);
    const innerHtmlStyleString = [
        "width: 100%",
        "height: 100%",
        "object-fit: cover",
        "overflow: hidden",
        `border-radius: ${borderRadiusValues["full"]}`,
    ].join(";");
    avatarHtml.setAttribute("style", innerHtmlStyleString);
    avatarHtml.setAttribute("aria-hidden", "true");

    return avatarHtml;
}

function renderAccountAvatarWithInitials({
    accountData,
    size,
    avatarData,
}: {
    accountData: AccountModelData;
    size: Spacing;
    avatarData: AvatarInitialsData;
}) {
    const {firstInitial, lastInitial} = getAccountAvatarInitials(accountData);

    const avatarHtml = new HtmlElementGenerator("span");

    avatarHtml.setAttribute("class", accountAvatarInitialsClassName);
    avatarHtml.setAttribute(
        "style",
        `transform: scale(${parseInt(size, 10) / 8}); color: ${avatarData.textColor}`,
    );
    avatarHtml.setAttribute("aria-hidden", "true");

    avatarHtml.appendChild(
        new HtmlTextGenerator(`${firstInitial.toUpperCase()}${lastInitial?.toUpperCase() ?? ""}`),
    );

    return avatarHtml;
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
