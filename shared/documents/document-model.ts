import {DocumentContent, DocumentContentSchema} from "~/shared/documents/document-content-schema";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

/**
 * A rich text, collaboratively editable, document.
 *
 * Code naming note: Whenever we refer to full documents product in code we
 * write it as "documents". Whenever we refer to an individual document we
 * write it as "document". This is why we call our model `DocumentModel` but we
 * call our table `DocumentsTable` and our RPCs `documents-rpc-definition.ts`.
 * `DocumentsTable` and `documents-rpc-definition.ts` are referring to the
 * entire documents product.
 */
export class DocumentModel
    extends Model(
        Schema.object({
            id: Schema.id,
            version: Schema.integer,
            content: DocumentContentSchema,
        }),
    )
    implements DocumentPreviewInterface
{
    public getTitle() {
        return getDocumentContentTitle(this.content);
    }

    public getTitleWithoutFallback() {
        return getDocumentContentTitleWithoutFallback(this.content);
    }
}

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
    return addFallbackToDocumentTitle(title);
}

/**
 * Return the title string and if the title is empty then return a fallback
 * name like "Untitled".
 */
function addFallbackToDocumentTitle(title: string): string {
    return title.trim().length > 0 ? title : "Untitled";
}

/**
 * The preview of a rich text document.
 *
 * We have a shared interface that both `DocumentModel` and
 * `DocumentPreviewModel` implement that code which needs a preview can use to
 * accept either underlying model.
 */
export interface DocumentPreviewInterface {
    readonly id: Id;
    getTitle(): string;
    getTitleWithoutFallback(): string;
}

/**
 * The preview of a rich text document.
 *
 * Documents can get pretty big so the preview is a smaller subset of the
 * document we can load quickly.
 */
export class DocumentPreviewModel
    extends Model(
        Schema.object({
            id: Schema.id,
            titleWithoutFallback: Schema.string,
        }),
    )
    implements DocumentPreviewInterface
{
    public getTitle() {
        return addFallbackToDocumentTitle(this.titleWithoutFallback);
    }

    public getTitleWithoutFallback() {
        return this.titleWithoutFallback;
    }
}
