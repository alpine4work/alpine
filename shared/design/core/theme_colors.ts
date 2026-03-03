import {Color} from "~/shared/design/core/colors.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";

/**
 * Theme color names like `red`, `blue`, and `green`.
 *
 * Excludes `grey` which is not a selectable theme.
 */
export type ThemeColor = Exclude<Color extends `${infer C}-${string}` ? C : never, "grey">;

/**
 * All theme color names like `red`, `blue`, and `green`.
 *
 * The order of these is sensitive - more similar hues should be closer to one and
 * other in the array.
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
 * Theme colors that can be used as a space theme color.
 */
export const selectableSpaceThemeColors = [
    "red",
    "orange",
    "green",
    "cyan",
    "indigo",
    "purple",
    "pink",
] as const;

export type SelectableSpaceThemeColor = (typeof selectableSpaceThemeColors)[number];

/**
 * Theme colors that cannot be used as a space theme color.
 */
type notSelectableSpaceThemeColors = [
    // Yellow is too bright as a space theme color. Before we enable this, we'll want
    // to do an accessibility audit on the color.
    "yellow",
    // Blue is too similar to indigo. We call indigo "blue" in the UI.
    "blue",
];

/**
 * The default color theme when the user is not within a space.
 */
export const defaultThemeColor: ThemeColor = "indigo";

/**
 * The default color theme when creating a new space.
 */
export const defaultSpaceThemeColor: SelectableSpaceThemeColor = "indigo";

/**
 * Is the provided color a theme color?
 */
export function isThemeColor(string: string): string is ThemeColor {
    return cast<ReadonlyArray<string>>(themeColors).includes(string);
}

// Validate we've captured all the selectable and not selectable theme colors. If
// this throws, you either forgot to add a new theme color to the
// `selectableSpaceThemeColors` array or you forgot to add a new theme color to the
// `notSelectableSpaceThemeColors` array.
assertEqualTypes<
    Exclude<(typeof themeColors)[number], notSelectableSpaceThemeColors[number]>,
    (typeof selectableSpaceThemeColors)[number]
>();
