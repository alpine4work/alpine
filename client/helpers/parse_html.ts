let detachedDocument: Document | null = null;

// Trick from jQuery -- some elements must be wrapped in other
// elements for innerHTML to work. I.e. if you do `div.innerHTML =
// "<td>..</td>"` the table cells are ignored.
const wrapMap: {readonly [node: string]: ReadonlyArray<string>} = {
    thead: ["table"],
    tbody: ["table"],
    tfoot: ["table"],
    caption: ["table"],
    colgroup: ["table"],
    col: ["table", "colgroup"],
    tr: ["table", "tbody"],
    td: ["table", "tbody", "tr"],
    th: ["table", "tbody", "tr"],
};

/**
 * Parses HTML from a string into DOM elements. Handles:
 *
 * - Security. We use a detached document for parsing elements.
 * - Edge cases around `<meta>` and `<table>` wrapper elements.
 *
 * You should use this instead of setting a string to `innerHTML` yourself.
 */
// Adapted from `prosemirror-view`:
// https://github.com/ProseMirror/prosemirror-view/blob/0656cdd5b19b084d571bfabbb9ecc350b2b2bc49/src/clipboard.ts#L219-L229
export function parseHtml(html: string): HTMLElement {
    const metaMatch = /^(\s*<meta [^>]*>)*/.exec(html);
    if (metaMatch) html = html.slice(metaMatch[0].length);
    let element: HTMLElement = (detachedDocument ??=
        document.implementation.createHTMLDocument("title")).createElement("div");
    const firstTag = /<([a-z][^>\s]+)/i.exec(html);
    let wrap;
    if ((wrap = firstTag && wrapMap[firstTag[1]!.toLowerCase()]))
        html =
            wrap.map(n => "<" + n + ">").join("") +
            html +
            wrap
                .map(n => "</" + n + ">")
                .reverse()
                .join("");
    element.innerHTML = html;
    if (wrap) {
        for (let i = 0; i < wrap.length; i++) {
            element = element.querySelector(wrap[i]!) ?? element;
        }
    }
    return element;
}
