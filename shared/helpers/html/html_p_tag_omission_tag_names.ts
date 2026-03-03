import {Lazy} from "~/shared/helpers/control/lazy.js";

/**
 * HTML tags that trigger [`<p>` tag omission logic][1]. Web browsers will parse:
 *
 * ```html
 * <p>Hello, <div style="display: inline; font-weight: bold">world</div>!</p>
 * ```
 *
 * ...as:
 *
 * ```html
 * <p>Hello,</p>
 * <div style="display: inline; font-weight: bold">world</div>
 * !
 * ```
 *
 * To fix this, you should never put an element like `<div>` inside a `<p>` tag.
 * Instead use `<span>`.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/p
 */
export const htmlPTagOmissionTagNames = new Lazy(
    () =>
        new Set([
            "address",
            "article",
            "aside",
            "blockquote",
            "details",
            "div",
            "dl",
            "fieldset",
            "figcaption",
            "figure",
            "footer",
            "form",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "header",
            "hgroup",
            "hr",
            "main",
            "menu",
            "nav",
            "ol",
            "pre",
            "search",
            "section",
            "table",
            "ul",
        ]),
);
