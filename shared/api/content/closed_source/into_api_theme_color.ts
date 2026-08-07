import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export type ApiThemeColor =
    | "Red"
    | "Orange"
    | "Yellow"
    | "Green"
    | "Cyan"
    | "Blue"
    | "Indigo"
    | "Purple"
    | "Pink";

export function intoApiThemeColor(themeColor: ThemeColor): ApiThemeColor {
    switch (themeColor) {
        case "red":
            return "Red";
        case "orange":
            return "Orange";
        case "yellow":
            return "Yellow";
        case "green":
            return "Green";
        case "cyan":
            return "Cyan";
        case "blue":
            return "Blue";
        case "indigo":
            return "Indigo";
        case "purple":
            return "Purple";
        case "pink":
            return "Pink";
        default:
            throw exhaustive(themeColor);
    }
}
