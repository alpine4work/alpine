import {ColorWithShade} from "~/shared/design/core/inverted_colors.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get a consistent theme color for an avatar based on the provided ID.
 * The same ID will always return the same theme color.
 */
export function getAvatarThemeColor(id: AccountId | SpaceId) {
    const hash = new StableRandom(id).randomInteger("avatarThemeColor", 0, themeColors.length);
    const colorIndex = hash % themeColors.length;
    const themeColor = assertExists(themeColors[colorIndex]);
    return lightModeAvatarThemes[themeColor];
}

const avatarBackgroundShade = "20";
const lightModeAvatarThemes: {
    [K in ThemeColor]: ColorWithShade;
} = {
    red: `red-${avatarBackgroundShade}`,
    orange: `orange-${avatarBackgroundShade}`,
    yellow: `yellow-${avatarBackgroundShade}`,
    green: `green-${avatarBackgroundShade}`,
    cyan: `cyan-${avatarBackgroundShade}`,
    blue: `blue-${avatarBackgroundShade}`,
    indigo: `indigo-${avatarBackgroundShade}`,
    purple: `purple-${avatarBackgroundShade}`,
    pink: `pink-${avatarBackgroundShade}`,
};
