import {Alpioneer, alpioneers} from "~/shared/accounts/known_account_ids.js";
import {colors} from "~/shared/design/core/colors.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get a consistent theme color for an avatar based on the provided ID.
 * The same ID will always return the same theme color.
 */
export function getAvatarThemeColors(id: AccountId | SpaceId) {
    if (id in alpioneers) {
        return hardcodedAccountThemes.get()[alpioneers[id]!];
    }

    const hash = new StableRandom(id).randomInteger("avatarThemeColor", 0, themeColors.length);
    const colorIndex = hash % themeColors.length;
    const themeColor = assertExists(themeColors[colorIndex]);
    return {
        backgroundColor: getBackgroundColor(themeColor),
        textColor: getTextColor(themeColor),
    };
}

const avatarBackgroundShade = "20";
function getBackgroundColor(themeColor: ThemeColor) {
    return colors[`${themeColor}-${avatarBackgroundShade}`];
}

const textColorShade = "80";
function getTextColor(themeColor: ThemeColor) {
    return colors[`${themeColor}-${textColorShade}`];
}

const hardcodedAccountThemes: Lazy<{
    [K in Alpioneer]: {
        backgroundColor: string;
        textColor: string;
    };
}> = new Lazy(() => ({
    caleb: {
        backgroundColor: getBackgroundColor("indigo"),
        textColor: getTextColor("blue"),
    },
    ian: {
        backgroundColor: getBackgroundColor("blue"),
        textColor: getTextColor("blue"),
    },
    josh: {
        backgroundColor: getBackgroundColor("purple"),
        textColor: getTextColor("purple"),
    },
    rachel: {
        backgroundColor: getBackgroundColor("cyan"),
        textColor: getTextColor("cyan"),
    },
}));
