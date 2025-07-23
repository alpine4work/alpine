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
    // Pure white background color is useful when embedding files since many files
    // have white backgrounds and look odd on an off-white background.
    "grey-0": "#ffffff",
    "grey-1": "#f8f8fc",
    "grey-5": "#ededf2",
    "grey-10": "#d9d9de",
    "grey-20": "#bcbcc4",
    "grey-30": "#a6a6ab",
    "grey-40": "#8c8c91",
    "grey-50": "#727279",
    "grey-60": "#5b5b62",
    "grey-70": "#4e4e55",
    "grey-80": "#3d3d42",
    "grey-90": "#27272b",
    "grey-99": "#1a1a1e",
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
    "grey-99-elevated-1": "#1d1d20",
    "grey-100-elevated-1": "#0e0e11",
    "grey-60-elevated-2": "#5f5f67",
    "grey-70-elevated-2": "#56565c",
    "grey-80-elevated-2": "#424247",
    "grey-90-elevated-2": "#2c2c30",
    "grey-99-elevated-2": "#202022",
    "grey-100-elevated-2": "#101013",

    "red-10": "#fee3cf",
    "red-20": "#feb99a",
    "red-30": "#fe9979",
    "red-40": "#fc7659",
    "red-50": "#ee493a",
    "red-60": "#d02a33",
    "red-70": "#a22232",
    "red-80": "#77122d",
    "red-90": "#480829",

    "orange-10": "#ffeabb",
    "orange-20": "#fbcf88",
    "orange-30": "#f8b254",
    "orange-40": "#f19936",
    "orange-50": "#e97417",
    "orange-60": "#c95410",
    "orange-70": "#a03517",
    "orange-80": "#782216",
    "orange-90": "#4b1108",

    "yellow-10": "#faf9c5",
    "yellow-20": "#f7f6a3",
    "yellow-30": "#f8f67e",
    "yellow-40": "#f8ea4f",
    "yellow-50": "#f5db32",
    "yellow-60": "#deab2b",
    "yellow-70": "#b97618",
    "yellow-80": "#7f3b0b",
    "yellow-90": "#531904",

    "green-10": "#e3f5bd",
    "green-20": "#c4e79a",
    "green-30": "#90d46f",
    "green-40": "#62be44",
    "green-50": "#31ab16",
    "green-60": "#048706",
    "green-70": "#02671d",
    "green-80": "#044826",
    "green-90": "#152b22",

    "cyan-10": "#d8fbf5",
    "cyan-20": "#a9edf3",
    "cyan-30": "#6dd7ee",
    "cyan-40": "#30bfeb",
    "cyan-50": "#18a7e6",
    "cyan-60": "#0e83ce",
    "cyan-70": "#115ea2",
    "cyan-80": "#143d75",
    "cyan-90": "#172241",

    "blue-10": "#d0ebfd",
    "blue-20": "#abd7fe",
    "blue-30": "#73b1f8",
    "blue-40": "#4595f5",
    "blue-50": "#1172dc",
    "blue-60": "#0961c3",
    "blue-70": "#134b9a",
    "blue-80": "#1e3773",
    "blue-90": "#111d43",

    "indigo-10": "#cbe1ff",
    "indigo-20": "#a0c4ff",
    "indigo-30": "#7fa4fd",
    "indigo-40": "#6187fa",
    "indigo-50": "#5166f0",
    "indigo-60": "#4055cb",
    "indigo-70": "#33439e",
    "indigo-80": "#2a3272",
    "indigo-90": "#1a2049",

    "purple-10": "#eee0fe",
    "purple-20": "#d4c0fb",
    "purple-30": "#b49cfb",
    "purple-40": "#987bf5",
    "purple-50": "#7a58ec",
    "purple-60": "#6748d3",
    "purple-70": "#5439a9",
    "purple-80": "#3c2776",
    "purple-90": "#2a1a49",

    "pink-10": "#ffe6ec",
    "pink-20": "#fcc2e1",
    "pink-30": "#f99ed6",
    "pink-40": "#f67acc",
    "pink-50": "#e857b9",
    "pink-60": "#c23da1",
    "pink-70": "#962f83",
    "pink-80": "#692467",
    "pink-90": "#3c154a",
} as const;
