import {Spacing} from "~/shared/design/core/spacing.js";

export type TextInputFontSize = "75" | "100";

/**
 * Height spacing for a `<TextInput>` with the provided `fontSize`.
 */
export function textInputHeightSpacingForFontSize(fontSize: TextInputFontSize): Spacing {
    // Matches the height values used by `<TextInput>`. For our supported font sizes:
    // `75` -> `7`, `100` -> `9`.
    return String(Number(fontSize) / 12.5 + 1) as Spacing;
}
