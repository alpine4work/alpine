/**
 * Convert an SVG HTML string to a CSS data URL. Produces a more readable data
 * URL string than `encodeURIComponent()`.
 *
 * Based on code from:
 * https://www.svgbackgrounds.com/tools/svg-to-css/
 */
export function convertSvgToCssDataUrl(svg: string): string {
    const safeSvg = svg
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3F")
        .replace(/[\t\n\r]/gm, " ")
        .replace(/\s\s+/g, " ")
        .replace(/"/g, "'")
        .replace(/> </g, "><");

    return `url("data:image/svg+xml,${safeSvg}")`;
}
