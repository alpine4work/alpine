/**
 * Does this element a [block level][1] display type?
 *
 * [1]: https://drafts.csswg.org/css-display/#the-display-properties
 */
export function isNodeBlockLevel(node: Node | null): boolean {
    return node instanceof HTMLElement && isHtmlElementBlockLevel(node);
}

/**
 * Does this element a [block level][1] display type?
 *
 * [1]: https://drafts.csswg.org/css-display/#the-display-properties
 */
export function isHtmlElementBlockLevel(element: HTMLElement): boolean {
    return isDisplayBlockLevel(getComputedStyle(element).display);
}

/**
 * Is this CSS `display` value a [block level][1] display type?
 *
 * [1]: https://drafts.csswg.org/css-display/#the-display-properties
 */
export function isDisplayBlockLevel(display: string): boolean {
    return (
        display === "block" ||
        display === "flow-root" ||
        display === "flex" ||
        display === "grid" ||
        display === "table"
    );
}
