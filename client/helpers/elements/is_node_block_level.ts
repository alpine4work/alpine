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
    const {display} = getComputedStyle(element);

    return (
        display === "block" ||
        display === "flow-root" ||
        display === "flex" ||
        display === "grid" ||
        display === "table"
    );
}
