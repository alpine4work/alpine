import {renderAvatarIconOverlay} from "~/client/accounts/internal/avatar_icon_overlay_html.js";
import {renderAvatarDefaultHtml} from "~/client/avatar/avatar_default_html.js";
import {backgroundColorVar, colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {borderRadius as borderRadiusValues} from "~/shared/design/core/border_radius.js";
import {colors} from "~/shared/design/core/colors.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {
    AccountAvatarDesign,
    AccountImageAvatarDesign,
    getAccountAvatarDesign,
} from "~/shared/spaces/get_account_avatar_design.js";

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
    const avatarDesign = getAccountAvatarDesign(accountData);
    const avatarPx = convertRemLengthToPx(size, spacingScale);

    const outerHtml = new HtmlElementGenerator("span");
    outerHtml.setAttribute("class", accountAvatarClassName);

    const outerStyle = {
        width: spacing[size],
        height: spacing[size],
        borderRadius: borderRadiusValues["full"],
        "background-color":
            avatarDesign.type === "Default"
                ? `${colors[`${avatarDesign.backgroundColor}-20`]}`
                : undefined,
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
        renderAccountAvatarDesign({
            size,
            avatarDesign,
        }),
    );

    if (avatarDesign.shouldShowRemovedAvatar) {
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

    if (avatarDesign.iconOverlayType) {
        const {iconCutout, iconOverlay} = renderAvatarIconOverlay({
            avatarPixelSize: avatarPx,
            iconType: avatarDesign.iconOverlayType,
        });
        outerHtml.appendChildren(iconCutout, iconOverlay);
    }

    return outerHtml;
}

function renderAccountAvatarDesign({
    size,
    avatarDesign,
}: {
    size: Spacing;
    avatarDesign: AccountAvatarDesign;
}) {
    switch (avatarDesign.type) {
        case "Image": {
            return renderAccountImageAvatarDesign(avatarDesign);
        }
        case "Default": {
            return renderAvatarDefaultHtml({
                size,
                reaction: avatarDesign.reaction,
            });
        }
        default:
            throw exhaustive(avatarDesign);
    }
}

const imageUrlCache = new WeakMap<Uint8Array, string>();

function renderAccountImageAvatarDesign(avatarDesign: AccountImageAvatarDesign) {
    const imageUrl = getOrSetDefaultMapValue(
        imageUrlCache,
        avatarDesign.content,
        () => `data:${avatarContentType};base64,${encodeBase64(avatarDesign.content)}`,
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
