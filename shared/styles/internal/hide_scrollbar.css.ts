import {style} from "@vanilla-extract/css";

/**
 * CSS class to hide scrollbars across using various techniques for
 * different browsers.
 *
 * See: https://stackoverflow.com/a/49278385/1568890
 */
export const hideScrollbarClassName = style({
    // Firefox
    scrollbarWidth: "none",
    // IE 10+
    msOverflowStyle: "none",
    selectors: {
        // WebKit (Chrome and Safari)
        "&::-webkit-scrollbar": {
            width: 0,
            height: 0,
        },
    },
});
