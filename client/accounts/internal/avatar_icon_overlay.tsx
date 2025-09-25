import {BotIcon} from "~/client/icons/bot_icon.js";
import {GhostIcon} from "~/client/icons/ghost_icon.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/styles/styles.js";

// IMPORTANT: If you update the HTML in this component you should also update
// `renderAvatarIconOverlay()` for code that needs to render avatars in
// `<ContentEditor>`.
/**
 * This component carves out the bottom right area from the avatar in the shape of the icon.
 * It then draws the icon within that cutout space.
 */
export function AvatarIconOverlay({
    avatarPixelSize,
    iconType,
}: {
    avatarPixelSize: number;
    iconType: "ghost" | "bot";
}) {
    const iconSize = avatarPixelSize / 1.618033988749; // golden ratio
    const iconStyleBase = {
        position: "absolute",
        width: iconSize,
        height: iconSize,
        // Position the SVG container just past the bounding box so that the ghost icon itself is
        // drawn almost exactly at the bottom right corner of the box. This looks correct at all
        // (tested) scales
        bottom: "-1px",
        right: "-1px",
    } as const;

    const Icon = iconType === "bot" ? BotIcon : GhostIcon;

    return (
        <>
            <Icon
                color={backgroundColorVar}
                style={{
                    ...iconStyleBase,
                    overflow: "hidden",
                }}
                // The stroke width gets scaled according to the ghost icons size, so
                // this hardcoded value looks good at all (tested) scales.
                strokeWidth={148}
            />
            <Icon
                color={colorSchemeVars["grey-60"]}
                style={{
                    ...iconStyleBase,
                    overflow: "visible",
                }}
            />
        </>
    );
}
