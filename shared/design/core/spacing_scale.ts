/**
 * The spacing scale for the design system.
 *
 * The spacing scale influences what the value of 1rem in CSS is. `medium` is
 * the default scale where 1rem is 16px. `large` sets 1rem at 20px.
 *
 * The pixel value of all `Spacing` values are whole pixels when the scale is
 * `medium`. If your `devicePixelRatio` is 1 then you should be using the
 * `medium` scale otherwise you may see rendering bugs. For other scales like
 * `large` spacing values like `2.5` will be 12.5px. Which is fine if your
 * `devicePixelRatio` is 2 or greater.
 *
 * If our `Platform` is `mobile` we always use a spacing scale of `large`. If
 * our `Platform` is `desktop` then we use a spacing scale of `medium`. But on
 * large monitors we'll switch our spacing scale to `large` to make better use
 * of the available space.
 */
export type SpacingScale = "medium" | "large";

/**
 * The minimum width to start rendering the `large` spacing scale (inclusive).
 * On large screens we increase our spacing scale to `large` to improve
 * legibility. Laptops will render at `medium` scale to prioritize information
 * density.
 *
 * [1280px is the breakpoint][1] used by Tailwind CSS for extra large screens.
 *
 * [1]: https://github.com/tailwindlabs/tailwindcss/blob/dd85aadc2c2904d1e934184d64ab3e1cd28313ae/packages/tailwindcss/theme.css#L280
 */
export const largeSpacingScaleMinWindowWidth = 1280;

/**
 * The value of 1rem in pixels based on the spacing scale.
 */
export const remPxBySpacingScale = {
    medium: 16,
    large: 20,
} as const satisfies {[Key in SpacingScale]: number};
