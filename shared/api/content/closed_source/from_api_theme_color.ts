import {ApiThemeColor} from "~/shared/api/content/closed_source/into_api_theme_color.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function fromApiThemeColor(apiThemeColor: ApiThemeColor): ThemeColor {
    switch (apiThemeColor) {
        case "Red":
            return "red";
        case "Orange":
            return "orange";
        case "Yellow":
            return "yellow";
        case "Green":
            return "green";
        case "Cyan":
            return "cyan";
        case "Blue":
            return "blue";
        case "Indigo":
            return "indigo";
        case "Purple":
            return "purple";
        case "Pink":
            return "pink";
        default:
            throw exhaustive(apiThemeColor);
    }
}
