import {Color} from "~/shared/design/core/colors.js";

/**
 * All the possible highlight colors for our content schema highlight inline style.
 */
export enum HighlightColor {
    Red = "red",
    // TODO(calebmer): Reconsider using orange instead of yellow. Some thoughts:
    //
    // - Comment styling might use yellow.
    // - White text on `yellow-10` is inaccessible (we can change `yellow-10`).
    // - We could call orange yellow to users. In light mode it looks like yellow.
    Orange = "orange",
    Green = "green",
    Blue = "blue",
    Purple = "purple",
}

export const highlightColors: ReadonlySet<HighlightColor> = new Set(Object.values(HighlightColor));

export function isHighlightColor(string: string): string is HighlightColor {
    return highlightColors.has(string as any);
}

export const colorByHighlightColor: {
    readonly [K in HighlightColor]: Color & `${string}-${number}`;
} = {
    [HighlightColor.Red]: "red-20",
    [HighlightColor.Orange]: "orange-20",
    [HighlightColor.Green]: "green-20",
    [HighlightColor.Blue]: "blue-20",
    [HighlightColor.Purple]: "purple-20",
};
