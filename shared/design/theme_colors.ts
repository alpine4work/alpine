import {Color} from "~/shared/design/colors.js";

/**
 * Theme color names like `red`, `blue`, and `green`.
 *
 * Excludes `grey` which is not a selectable theme.
 */
export type ThemeColor = Exclude<Color extends `${infer C}-${string}` ? C : never, "grey">;

/**
 * All theme color names like `red`, `blue`, and `green`.
 *
 * The order of these is sensitive - more similar hues should be closer
 * to one and other in the array.
 *
 * Excludes `grey` which is not a selectable theme.
 */
export const themeColors = [
    "red",
    "orange",
    "yellow",
    "green",
    "cyan",
    "blue",
    "indigo",
    "purple",
    "pink",
] as const;

/**
 * The default color theme when the user is not within a space.
 */
export const defaultThemeColor: ThemeColor = "indigo";
