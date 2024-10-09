/**
 * Copy text to clipboard in a way that works across browsers.
 */
export async function writeTextToClipboard(text: string) {
    if (!navigator.clipboard) {
        writeTextToClipboardFallback(text);
        return;
    }

    await navigator.clipboard.writeText(text);
}

// Code adapted from:
// https://github.com/lgarron/clipboard-polyfill/blob/c24845e280262858cf40c5fce8443abf5a8dc51b/src/clipboard-polyfill/strategies/dom.ts#L76-L103
export function writeTextToClipboardFallback(text: string) {
    const temporaryElement = document.createElement("div");

    // Setting an individual property does not support `!important`, so we set the
    // whole style instead of just the `-webkit-user-select` property.
    temporaryElement.setAttribute("style", "-webkit-user-select: text !important");

    // Use shadow DOM if available.
    let spanParent: Node = temporaryElement;
    if (temporaryElement.attachShadow) {
        spanParent = temporaryElement.attachShadow({mode: "open"});
    }

    const spanElement = document.createElement("span");
    spanElement.innerText = text;

    spanParent.appendChild(spanElement);
    document.body.appendChild(temporaryElement);

    {
        const selection = document.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNodeContents(spanElement);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    document.execCommand("copy");

    document.getSelection()?.removeAllRanges();
    document.body.removeChild(temporaryElement);
}
