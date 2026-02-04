import {colorSchemeVars} from "~/client/web/styles/core/internal/color_scheme.css.js";

export const inputPlaceholderFontWeight = 340;

/**
 * Styles associated with an input placeholder.
 */
export const inputPlaceholderStyles = {
    color: colorSchemeVars["grey-30"],
    // Use a slightly lighter weight than `normal` (400) in addition to a lighter
    // color to indicate this text is a placeholder.
    fontWeight: inputPlaceholderFontWeight,
};
