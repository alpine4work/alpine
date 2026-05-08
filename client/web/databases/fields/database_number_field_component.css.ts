import {style} from "@vanilla-extract/css";

/**
 * `<input type="number">` with the up/down spinner
 * buttons hidden across browsers.
 */
export const numberInputClassName = style({
    appearance: "textfield",
    MozAppearance: "textfield",
    selectors: {
        "&::-webkit-inner-spin-button, &::-webkit-outer-spin-button": {
            WebkitAppearance: "none",
            margin: 0,
        },
    },
});
