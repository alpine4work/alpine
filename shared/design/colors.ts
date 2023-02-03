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
    "grey-5": "#ededf2",
    "grey-10": "#d7d7db",
    "grey-20": "#bcbcc4",
    "grey-30": "#a6a6ab",
    "grey-40": "#87878c",
    "grey-50": "#6d6d73",
    "grey-60": "#57575c",
    "grey-70": "#44444a",
    "grey-80": "#323236",
    "grey-90": "#212124",

    // Our darkest grey is not a part of the grey color spectrum. In order to
    // render the product in dark mode, we invert the color spectrum so
    // `grey-0` becomes `grey-90`. We don't want our darkest grey to participate
    // in the dark mode color spectrum inversion. A white background in light mode
    // (`grey-0`) should map to our second darkest grey in dark mode (`grey-90`).
    // That way we can render our darkest grey color behind `grey-90` to create a
    // feeling of depth in dark mode.
    //
    // We also use our darkest grey as the color of text in light mode while we use
    // `grey-0` as our text color in dark mode. This requires special handling
    // because `grey-0` does not map to this color.
    "grey-dark": "#0b0b0d",

    // The grey we use for speech bubbles. Between `grey-0` and `grey-5`. We only
    // use this for the speech bubble background color to help contrast with other
    // elements using normal colors.
    "grey-bubble-light": "#f2f2f5",
    "grey-bubble-dark": "#2b2b2e",

    "red-5": "#fcf1e8",
    "red-10": "#ffd4c2",
    "red-20": "#fab29a",
    "red-30": "#f58672",
    "red-40": "#f15b4a",
    "red-50": "#e83626",
    "red-60": "#c02425",
    "red-70": "#951b27",
    "red-80": "#6a1229",
    "red-90": "#3e0923",

    "orange-5": "#fef8e1",
    "orange-10": "#ffedb8",
    "orange-20": "#fbd38f",
    "orange-30": "#f8ba65",
    "orange-40": "#f5a03c",
    "orange-50": "#ef8616",
    "orange-60": "#c75f0f",
    "orange-70": "#9b410c",
    "orange-80": "#702208",
    "orange-90": "#450505",

    "yellow-5": "#f7fae1",
    "yellow-10": "#faf9c5",
    "yellow-20": "#f7f6a3",
    "yellow-30": "#f8f67e",
    "yellow-40": "#f8ea4f",
    "yellow-50": "#f5db32",
    "yellow-60": "#deab2b",
    "yellow-70": "#b97618",
    "yellow-80": "#7f3b0b",
    "yellow-90": "#531904",

    "green-5": "#f0fbda",
    "green-10": "#e6f8be",
    "green-20": "#c7ee99",
    "green-30": "#98e076",
    "green-40": "#72d352",
    "green-50": "#4bc72e",
    "green-60": "#399f2f",
    "green-70": "#267730",
    "green-80": "#124a2b",
    "green-90": "#042325",

    "cyan-5": "#e6faf3",
    "cyan-10": "#c9f8ed",
    "cyan-20": "#9fe7ea",
    "cyan-30": "#6ccee4",
    "cyan-40": "#3bbce3",
    "cyan-50": "#04a7ec",
    "cyan-60": "#0085cc",
    "cyan-70": "#035996",
    "cyan-80": "#023974",
    "cyan-90": "#011846",

    "blue-5": "#e0f7ff",
    "blue-10": "#c2efff",
    "blue-20": "#94d2fb",
    "blue-30": "#5bb2f5",
    "blue-40": "#3094ff",
    "blue-50": "#0b7bff",
    "blue-60": "#0b5eca",
    "blue-70": "#0f4594",
    "blue-80": "#092c66",
    "blue-90": "#031338",

    "indigo-5": "#e6f3ff",
    "indigo-10": "#c4e0ff",
    "indigo-20": "#84b3f0",
    "indigo-30": "#568be2",
    "indigo-40": "#2a64d1",
    "indigo-50": "#0446cc",
    "indigo-60": "#04359d",
    "indigo-70": "#072977",
    "indigo-80": "#0b1e50",
    "indigo-90": "#0e1229",

    "purple-5": "#f7f0ff",
    "purple-10": "#f0e0ff",
    "purple-20": "#cab6fa",
    "purple-30": "#a68ff5",
    "purple-40": "#8167f0",
    "purple-50": "#5c3feb",
    "purple-60": "#4c33bf",
    "purple-70": "#3c2693",
    "purple-80": "#2c1a67",
    "purple-90": "#1c0d3b",

    "pink-5": "#fcf0f1",
    "pink-10": "#ffe6ec",
    "pink-20": "#fcc2e1",
    "pink-30": "#f99ed6",
    "pink-40": "#f579cb",
    "pink-50": "#f255c0",
    "pink-60": "#c445a3",
    "pink-70": "#973585",
    "pink-80": "#6a2568",
    "pink-90": "#3c154a",
} as const;
