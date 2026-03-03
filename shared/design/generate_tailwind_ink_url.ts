import Color from "color";
import {colors} from "~/shared/design/core/colors.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";

/**
 * Generate a link for exploring our color pallete in https://tailwind.ink. A
 * wonderful tool that graphs luminosity, chroma, and hue for our colors. Letting
 * you drag around to make sure colors have a similar luminosity and chroma.
 *
 * To use this we recommend adding
 * `console.log(generateTailwindInkUrl().toString())` to your `adhoc_local.ts`
 * script and running `bazel run //admin/adhoc`.
 */
export function generateTailwindInkUrl() {
    const colorPallete = themeColors
        .map(themeColor => {
            return [
                // https://tailwind.inc expects a 10 color pallete. However, our color palletes
                // only have 9 colors. So include white as the first color in all palletes.
                "ffffff",
                Color(colors[`${themeColor}-10`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-20`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-30`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-40`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-50`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-60`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-70`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-80`]).hex().toLowerCase().slice(1),
                Color(colors[`${themeColor}-90`]).hex().toLowerCase().slice(1),
            ].join("");
        })
        .join("");

    return new URL(`https://tailwind.ink?p=${themeColors.length}.${colorPallete}`);
}
