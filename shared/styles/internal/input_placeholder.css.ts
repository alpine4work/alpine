import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";

/**
 * Styles associated with an input placeholder.
 */
export const inputPlaceholderStyles = {
    color: colorSchemeVars["grey-30"],
    // Use a slightly lighter weight than `normal` (400) in addition to a lighter
    // color to indicate this text is a placeholder.
    fontWeight: 340,
};
