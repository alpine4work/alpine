import {style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";

/**
 * The color of input placeholder text.
 */
export const inputPlaceholderColor = colorSchemeVars["grey-30"];

export const darkColorSchemeInputPlaceholderColorConstClassName = style({
    selectors: {
        "&::placeholder": {
            color: colorSchemeVars["grey-60-const"],
        },
    },
});
