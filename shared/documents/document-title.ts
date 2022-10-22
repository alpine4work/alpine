import {DocumentContent} from "~/shared/documents/document-content-schema";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Get the title of a document as it is. If the document has no title then a
 * empty string will be returned.
 */
export function getDocumentContentTitleWithoutFallback(content: DocumentContent): string {
    const childNode = content.child(0);
    assert(childNode.type.name === "title");
    return childNode.textContent;
}

/**
 * Get the title of a document.
 *
 * If there is no title then the document is given a fallback name
 * like "Untitled".
 */
export function getDocumentContentTitle(content: DocumentContent): string {
    const title = getDocumentContentTitleWithoutFallback(content);
    return title.trim().length > 0 ? title : "Untitled";
}
