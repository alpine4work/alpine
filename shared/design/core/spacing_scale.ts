import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

/**
 * The spacing scale for the design system.
 *
 * The spacing scale influences what the value of 1rem in CSS is. `small` is the
 * default scale where 1rem is 16px. `large` sets 1rem at 20px.
 *
 * The pixel value of all `Spacing` values are whole pixels when the scale is
 * `small`. If your `devicePixelRatio` is 1 then you should be using the `small`
 * scale otherwise you may see rendering bugs. For other scales like `large`
 * spacing values like `2.5` will be 12.5px. Which is fine if your
 * `devicePixelRatio` is 2 or greater.
 *
 * If our `Platform` is `mobile` we always use a spacing scale of `large`. If our
 * `Platform` is `desktop` then we use a spacing scale of `small`. But on large
 * monitors we'll switch our spacing scale to `medium` to make better use of the
 * available space.
 */
export type SpacingScale = "small" | "medium" | "large";

/**
 * All the spacing scales.
 */
export const allSpacingScales = ["small", "medium", "large"] as const;

assertEqualTypes<(typeof allSpacingScales)[number], SpacingScale>();

/**
 * The minimum width to start rendering the `medium` spacing scale (inclusive). On
 * large screens we increase our spacing scale to `medium` to improve legibility.
 * Laptops will render at `small` scale to prioritize information density.
 *
 * [1280px is the breakpoint][1] used by Tailwind CSS for extra large screens.
 *
 * [1]:
 *     https://github.com/tailwindlabs/tailwindcss/blob/dd85aadc2c2904d1e934184d64ab3e1cd28313ae/packages/tailwindcss/theme.css#L280
 */
export const mediumSpacingScaleMinWindowWidth = 1280;

/**
 * The value of 1rem in pixels based on the spacing scale.
 */
export const remPxBySpacingScale = {
    small: 16,
    medium: 18,
    large: 20,
} as const satisfies {[Key in SpacingScale]: number};
