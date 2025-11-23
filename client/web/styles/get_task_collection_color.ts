import {Sprinkles} from "~/client/web/styles/styles.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";

/**
 * Get the color we render for a task collection's `ThemeColor`. This is in
 * `~/client/styles` instead of `~/client/tasks` since `~/client/search` needs
 * access to it (for rendering `SearchEntityMedia`) without depending on task
 * code.
 */
export function getTaskCollectionColor(color: ThemeColor | null): Sprinkles["color"] {
    if (color === null) return "grey-20";
    return `${color}-50`;
}
