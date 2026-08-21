import {AvatarDefault} from "~/client/web/avatar/avatar_default.js";
import {AvatarImage} from "~/client/web/avatar/avatar_image.js";
import {BotIcon} from "~/client/web/icons/bot_icon.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {backgroundColorVar, colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {colors} from "~/shared/design/core/colors.js";
import {RemLength, Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {getAvatarDefaultDesign} from "~/shared/spaces/get_avatar_default_design.js";

/**
 * Renders a bot's avatar (uploaded image or default design) with the bot icon
 * overlaid in the bottom right corner.
 */
export function BotAvatar({
    bot,
    size,
    backgroundBorderWidth,
}: {
    bot: Pick<Bot, "id" | "avatar">;
    size: Spacing | RemLength;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    const spacingScale = useSpacingScale();

    const avatarPx = convertRemLengthToPx(size, spacingScale);
    const avatarDesign = getBotAvatarDesign(bot);
    const avatarRemLength = size in spacing ? spacing[size as Spacing] : (size as RemLength);

    return (
        <span
            // Unlike `accountAvatarClassName` this doesn't set `zIndex: 0`, so the bot icon
            // overlay (`zIndex: 10`) can render above sibling overlays like the avatar
            // uploader's hover overlay.
            className={sprinkles({display: "block", flexShrink: "0", position: "relative"})}
            style={{
                width: avatarRemLength,
                height: avatarRemLength,
                borderRadius: borderRadius["full"],
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
            <BotAvatarDesignView size={size} avatarDesign={avatarDesign} />
            <BotIconOverlay avatarPx={avatarPx} />
        </span>
    );
}

function BotAvatarDesignView({
    size,
    avatarDesign,
}: {
    size: Spacing | RemLength;
    avatarDesign: BotAvatarDesign;
}) {
    switch (avatarDesign.type) {
        case "Image": {
            return <BotImageAvatarDesignView avatarDesign={avatarDesign} />;
        }
        case "Default": {
            return <AvatarDefault size={size} reaction={avatarDesign.reaction} />;
        }
        default:
            throw exhaustive(avatarDesign);
    }
}

function BotImageAvatarDesignView({avatarDesign}: {avatarDesign: BotImageAvatarDesign}) {
    return <AvatarImage content={avatarDesign.content} borderRadius="full" />;
}

type BotImageAvatarDesign = {
    type: "Image";
    content: Uint8Array;
};
type BotDefaultAvatarDesign = {
    type: "Default";
    reaction: Reaction;
    backgroundColor: ThemeColor;
};
type BotAvatarDesign = BotImageAvatarDesign | BotDefaultAvatarDesign;

function getBotAvatarDesign(bot: Pick<Bot, "id" | "avatar">): BotAvatarDesign {
    return bot.avatar?.content
        ? {type: "Image", content: bot.avatar.content}
        : {
              type: "Default",
              ...getAvatarDefaultDesign(bot.id, null),
          };
}

export function BotIconOverlay({avatarPx}: {avatarPx: number}) {
    const iconSize = avatarPx / 1.618033988749; // golden ratio
    const iconStyleBase = {
        position: "absolute",
        width: iconSize,
        height: iconSize,
        zIndex: 10,
        bottom: "-1px",
        right: "-1px",
    } as const;

    return (
        <>
            <BotIcon
                color={backgroundColorVar}
                style={{
                    ...iconStyleBase,
                    overflow: "hidden",
                }}
                strokeWidth={96}
            />
            <BotIcon
                color={colorSchemeVars["grey-60"]}
                style={{
                    ...iconStyleBase,
                    overflow: "visible",
                }}
            />
        </>
    );
}
