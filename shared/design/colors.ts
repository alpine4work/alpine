/**
 * Any color in our pallette.
 */
export type Color = keyof typeof colors;

/**
 * Our color pallette.
 *
 * Colors are used for theming so we try to have colors that map to common
 * brand colors.
 *
 * We have more shades of grey than other colors for more range of expression
 * in dark modes.
 *
 * We aim for our theme colors to have similar luminosity and chroma values in
 * the [HCL color system][1]. That way our colors can be used interchangeably
 * without looking odd. An excellent tool for debugging our color scheme and
 * tweaking it for the HCL color space is https://tailwind.ink. To import our
 * color scheme into https://tailwind.ink use the `generateTailwindInkUrl()`
 * function. From there you can see how we're doing on maintaining luminosity
 * and chroma values for our color scheme and manually drag colors around to
 * tweak them.
 *
 * `yellow` we don't try to maintain a similar luminosity value as other theme
 * colors as yellow will just end up looking muddy and ugly.
 *
 * [1]: https://en.wikipedia.org/wiki/HCL_color_space
 */
export const colors = {
    "grey-0": "#fbfbfc",
    "grey-5": "#ebebf0",
    "grey-10": "#d9d9de",
    "grey-20": "#bcbcc4",
    "grey-30": "#a6a6ab",
    "grey-40": "#8c8c91",
    "grey-50": "#727279",
    "grey-60": "#5b5b62",
    "grey-70": "#4e4e55",
    "grey-80": "#3d3d42",
    "grey-90": "#27272b",
    "grey-100": "#0b0b0d",

    // We have a set of slightly lighter greys for elevated surfaces in dark mode.
    // When we render peeks on top of other content you have arbitrary peek content
    // above other arbitrary content. In dark mode we can't use shadows to simulate
    // depth and differentiate elements. So instead we make surfaces that are
    // "higher up" lighter as if they're closer to a light source.
    //
    // Since peeks can contain arbitrary content we bake this property into the
    // color system instead of writing a bunch of `isPeek` logic. These grey colors
    // are just a hair lighter in peeks, it's a small detail that's almost
    // unnoticeable but it helps reinforce a sense of depth subconsciously.
    "grey-70-elevated-1": "#515158",
    "grey-80-elevated-1": "#404045",
    "grey-90-elevated-1": "#2a2a2d",
    "grey-100-elevated-1": "#0e0e11",
    "grey-60-elevated-2": "#5f5f67",
    "grey-70-elevated-2": "#56565c",
    "grey-80-elevated-2": "#424247",
    "grey-90-elevated-2": "#2c2c30",
    "grey-100-elevated-2": "#101013",

    "red-10": "#fee3cf",
    "red-20": "#feb99a",
    "red-30": "#fe9676",
    "red-40": "#fc7659",
    "red-50": "#f75644",
    "red-60": "#d9383c",
    "red-70": "#a52634",
    "red-80": "#77122d",
    "red-90": "#480829",

    "orange-10": "#ffedb8",
    "orange-20": "#fbd28a",
    "orange-30": "#fbb95b",
    "orange-40": "#f59b2b",
    "orange-50": "#ea8200",
    "orange-60": "#d2640d",
    "orange-70": "#a64812",
    "orange-80": "#772d0d",
    "orange-90": "#4a1205",

    "yellow-10": "#faf9c5",
    "yellow-20": "#f7f6a3",
    "yellow-30": "#f8f67e",
    "yellow-40": "#f8ea4f",
    "yellow-50": "#f5db32",
    "yellow-60": "#deab2b",
    "yellow-70": "#b97618",
    "yellow-80": "#7f3b0b",
    "yellow-90": "#531904",

    "green-10": "#e6f8c0",
    "green-20": "#c4e79a",
    "green-30": "#93d772",
    "green-40": "#68c449",
    "green-50": "#39b11e",
    "green-60": "#2b9424",
    "green-70": "#1a6d27",
    "green-80": "#124a2b",
    "green-90": "#09282a",

    "cyan-10": "#d6fcf3",
    "cyan-20": "#9fe7ea",
    "cyan-30": "#6cd6ed",
    "cyan-40": "#22c4ef",
    "cyan-50": "#06aae8",
    "cyan-60": "#1b85c9",
    "cyan-70": "#165f9d",
    "cyan-80": "#143d75",
    "cyan-90": "#15204b",

    "blue-10": "#c2efff",
    "blue-20": "#96dbfd",
    "blue-30": "#65c4fd",
    "blue-40": "#31a9fa",
    "blue-50": "#1e8ffb",
    "blue-60": "#2972d6",
    "blue-70": "#2453a4",
    "blue-80": "#1c3672",
    "blue-90": "#111d43",

    "indigo-10": "#cbe1ff",
    "indigo-20": "#a0c4ff",
    "indigo-30": "#7fa4fd",
    "indigo-40": "#6187fa",
    "indigo-50": "#5166f0",
    "indigo-60": "#4055cb",
    "indigo-70": "#31439e",
    "indigo-80": "#213373",
    "indigo-90": "#16214a",

    "purple-10": "#eee0fe",
    "purple-20": "#d6c2fe",
    "purple-30": "#b69efd",
    "purple-40": "#9f81fe",
    "purple-50": "#8762fa",
    "purple-60": "#704fde",
    "purple-70": "#5439a9",
    "purple-80": "#3c2776",
    "purple-90": "#2a1a49",

    "pink-10": "#ffe6ec",
    "pink-20": "#fcc2e1",
    "pink-30": "#f99ed6",
    "pink-40": "#f67acc",
    "pink-50": "#ea59bb",
    "pink-60": "#c53fa3",
    "pink-70": "#962f83",
    "pink-80": "#692467",
    "pink-90": "#3c154a",
} as const;
