import {Page} from "@playwright/test";

/**
 * Find the doc range of the first text node containing `text` in the page's live
 * document editor, in document order. Runs against the `dev.contentEditor` debug
 * tools, so the page must have a mounted document editor. Returns null when no
 * text node matches.
 */
export async function findDocumentTextRange(
    page: Page,
    text: string,
): Promise<{from: number; to: number} | null> {
    return await page.evaluate(searchText => {
        const view = (window as any).dev.contentEditor.view;
        let range: {from: number; to: number} | null = null;
        view.state.doc.descendants((node: any, pos: number) => {
            if (range === null && node.isText && node.text.includes(searchText)) {
                range = {from: pos, to: pos + node.nodeSize};
            }
        });
        return range as {from: number; to: number} | null;
    }, text);
}
