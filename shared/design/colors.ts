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
    "red-40": "#fa7854",
    "red-50": "#f75644",
    "red-60": "#d9383c",
    "red-70": "#a42835",
    "red-80": "#6e172c",
    "red-90": "#3e0923",

    "orange-10": "#ffedb8",
    "orange-20": "#fbd28a",
    "orange-30": "#fbb95b",
    "orange-40": "#f59b2b",
    "orange-50": "#ea8200",
    "orange-60": "#d2640d",
    "orange-70": "#a64812",
    "orange-80": "#772d0d",
    "orange-90": "#441002",

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
    "green-90": "#042325",

    "cyan-10": "#d6fcf3",
    "cyan-20": "#9fe7ea",
    "cyan-30": "#74d5eb",
    "cyan-40": "#41c0e7",
    "cyan-50": "#11a9e8",
    "cyan-60": "#0085cc",
    "cyan-70": "#035996",
    "cyan-80": "#023974",
    "cyan-90": "#021847",

    "blue-10": "#c2efff",
    "blue-20": "#96dbfd",
    "blue-30": "#65c4fd",
    "blue-40": "#31a9fa",
    "blue-50": "#1e8ffb",
    "blue-60": "#2972d6",
    "blue-70": "#1f50a1",
    "blue-80": "#12306b",
    "blue-90": "#09183d",

    "indigo-10": "#c4e0ff",
    "indigo-20": "#84b3f0",
    "indigo-30": "#568be2",
    "indigo-40": "#2a64d1",
    "indigo-50": "#0446cc",
    "indigo-60": "#04359d",
    "indigo-70": "#072977",
    "indigo-80": "#0b1e50",
    "indigo-90": "#10152c",

    "purple-10": "#f0e0ff",
    "purple-20": "#cab6fa",
    "purple-30": "#a68ff5",
    "purple-40": "#8167f0",
    "purple-50": "#6143de",
    "purple-60": "#4c33bf",
    "purple-70": "#3c2693",
    "purple-80": "#2c1a67",
    "purple-90": "#1c0d3b",

    "pink-10": "#ffe6ec",
    "pink-20": "#fcc2e1",
    "pink-30": "#f99ed6",
    "pink-40": "#f67acc",
    "pink-50": "#ee5dbf",
    "pink-60": "#c445a3",
    "pink-70": "#973585",
    "pink-80": "#6a2568",
    "pink-90": "#3c154a",
} as const;
