/**
 * Our CSS reset is derived from the [tailwindcss preflight][1] file.
 *
 * This file is aimed at removing browser styles and fixing compatibility issues.
 * If you want to set a style by default globally, put it in
 * `bootstrap-style-global.css.ts`.
 *
 * It is important that this CSS file is imported before `sprinkles.css.ts`!
 * Otherwise styles like our button background color reset will take precedence.
 *
 * [1]:
 *     https://github.com/tailwindlabs/tailwindcss/blob/262079e1e5809d2a58e8d264d179c712e3d5d953/src/css/preflight.css#L1
 */

import {globalStyle} from "@vanilla-extract/css";

globalStyle("*, ::before, ::after", {
    // Prevent padding and border from affecting element width.
    boxSizing: "border-box",
    // Allow adding a border to an element by just adding a border-width.
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: "currentColor",
});

globalStyle("html", {
    // Prevent adjustments of font size since our app is built with responsive design
    // in mind. https://developer.mozilla.org/en-US/docs/Web/CSS/text-size-adjust
    WebkitTextSizeAdjust: "100%",
    textSizeAdjust: "100%",
    // Use a more readable tab size.
    MozTabSize: 4,
    tabSize: 4,
    // Try to reduce browser incompatibilities.
    textRendering: "optimizeLegibility",
    WebkitFontSmoothing: "subpixel-antialiased", // https://usabilitypost.com/2010/08/26/font-smoothing
});

globalStyle("body", {
    // Remove the margin in all browsers.
    margin: 0,
});

globalStyle("hr", {
    // Add the correct height in Firefox.
    height: 0,
    // Correct the inheritance of border color in Firefox.
    // (https://bugzilla.mozilla.org/show_bug.cgi?id=190655)
    color: "inherit",
    // Ensure horizontal rules are visible by default.
    borderTopWidth: 1,
});

// Add the correct text decoration in Chrome, Edge, and Safari.
globalStyle("abbr:where([title])", {
    textDecoration: "underline dotted",
});

// Remove the default font size and weight for headings.
globalStyle("h1, h2, h3, h4, h5, h6", {
    fontSize: "inherit",
    fontWeight: "inherit",
});

// Reset links to optimize for opt-in styling instead of opt-out.
globalStyle("a", {
    color: "inherit",
    textDecoration: "inherit",
});

// Add the correct font weight in Edge and Safari.
globalStyle("b, strong", {
    fontWeight: "bolder",
});

// Correct the odd `em` font sizing in all browsers.
globalStyle("code, kbd, samp, pre", {
    fontSize: "1em",
});

globalStyle("small", {
    // Add the correct font size in all browsers.
    fontSize: "80%",
});

// Prevent `sub` and `sup` elements from affecting the line height in all browsers.
globalStyle("sub, sup", {
    fontSize: "75%",
    lineHeight: 0,
    position: "relative",
    verticalAlign: "baseline",
});

globalStyle("sub", {
    bottom: "-0.25em",
});

globalStyle("sup", {
    top: "-0.5em",
});

globalStyle("table", {
    // Remove text indentation from table contents in Chrome and Safari.
    // (https://bugs.chromium.org/p/chromium/issues/detail?id=999088,
    // https://bugs.webkit.org/show_bug.cgi?id=201297)
    textIndent: "0",
    // Correct table border color inheritance in all Chrome and Safari.
    // (https://bugs.chromium.org/p/chromium/issues/detail?id=935729,
    // https://bugs.webkit.org/show_bug.cgi?id=195016)
    borderColor: "inherit",
    // Remove gaps between table borders by default.
    borderCollapse: "collapse",
});

globalStyle("button, input, optgroup, select, textarea", {
    // Change the font styles in all browsers.
    fontFamily: "inherit",
    fontSize: "100%",
    fontWeight: "inherit",
    lineHeight: "inherit",
    color: "inherit",
    // Remove the margin in Firefox and Safari.
    margin: 0,
    // Remove default padding in all browsers.
    padding: 0,
});

// `:where()` has a specificity of 0. So a sprinkles CSS class that sets background
// color can override it.
globalStyle(":where(input[type='text'])", {
    // Remove default background color.
    backgroundColor: "transparent",
});

// Remove the inheritance of text transform in Edge and Firefox.
globalStyle("button, select", {
    textTransform: "none",
});

globalStyle("button, [type='button'], [type='reset'], [type='submit']", {
    // Correct the inability to style clickable types in iOS and Safari.
    WebkitAppearance: "button",
    // Remove default button styles.
    backgroundColor: "transparent",
    backgroundImage: "none",
});

// Use the modern Firefox focus style for all focusable elements.
globalStyle(":-moz-focusring", {
    outline: "auto",
});

// Remove the additional `:invalid` styles in Firefox.
// (https://github.com/mozilla/gecko-dev/blob/2f9eacd9d3d995c937b4251a5557d95d494c9be1/layout/style/res/forms.css#L728-L737)
globalStyle(":-moz-ui-invalid", {
    boxShadow: "none",
});

// Add the correct vertical alignment in Chrome and Firefox.
globalStyle("progress", {
    verticalAlign: "baseline",
});

// Correct the cursor style of increment and decrement buttons in Safari.
globalStyle("::-webkit-inner-spin-button, ::-webkit-outer-spin-button", {
    height: "auto",
});

globalStyle("[type='search']", {
    // Correct the odd appearance in Chrome and Safari.
    WebkitAppearance: "textfield",
    // Correct the outline style in Safari.
    outlineOffset: -2,
});

// Remove the inner padding in Chrome and Safari on macOS.
globalStyle("::-webkit-search-decoration", {
    WebkitAppearance: "none",
});

globalStyle("::-webkit-file-upload-button", {
    // Correct the inability to style clickable types in iOS and Safari.
    WebkitAppearance: "button",
    // Change font properties to `inherit` in Safari.
    font: "inherit",
});

// Add the correct display in Chrome and Safari.
globalStyle("summary", {
    display: "list-item",
});

// Removes the default spacing and border for appropriate elements.
globalStyle("blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre", {
    margin: 0,
});

globalStyle("fieldset", {
    margin: 0,
    padding: 0,
});

globalStyle("legend", {
    padding: 0,
});

globalStyle("ol, ul, menu", {
    listStyle: "none",
    margin: 0,
    padding: 0,
});

// Prevent resizing textareas horizontally by default.
globalStyle("textarea", {
    resize: "vertical",
});

globalStyle("input::placeholder, textarea::placeholder", {
    // Reset the default placeholder opacity in Firefox.
    // (https://github.com/tailwindlabs/tailwindcss/issues/3300)
    opacity: 1,
});

globalStyle("img, svg, video, canvas, audio, iframe, embed, object", {
    // Make replaced elements `display: block` by default.
    // (https://github.com/mozdevs/cssremedy/issues/14)
    display: "block",
    // Add `vertical-align: middle` to align replaced elements more sensibly by
    // default.
    // (https://github.com/jensimmons/cssremedy/issues/14#issuecomment-634934210) This
    // can trigger a poorly considered lint error in some tools but is included by
    // design.
    verticalAlign: "middle",
});

// Constrain images and videos to the parent width and preserve their intrinsic
// aspect ratio. (https://github.com/mozdevs/cssremedy/issues/14)
globalStyle("img, video", {
    maxWidth: "100%",
    height: "auto",
});
