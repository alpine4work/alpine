import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
} from "~/server/agents/internal/durable_object_storage_collection.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

/**
 * Uniquely identifies a document in local storage. Every time the _document_ is
 * read, we add it to the collection with a unique key. This way, the LLM is privy
 * to document updates when users ask it to do something like "Read the document
 * again". On first read, it will load the first page of the document with a link
 * to the next page (if there is one).
 */
export type AgentLocalDocumentKey = `/local/document/${DocumentId}-${number}`;

// When reading document links, we don't want to load the entire document into the
// Agent's context right away. For long documents, this would be extremely token
// inefficient. Instead, we load the document into memory when it's read and show
// the agent the first page. When the agent requests the next page, we don't want
// to make another API call to load the document, so instead, we store the document
// in local storage on read. We then use the local document when fetching the
// next/previous pages.
//
// Since documents can be updated, we also want to make sure that the document in
// local storage is up-to-date. So on each read, we re-add the document to the
// collection and update the document's dedupe number.
const AgentLocalDocumentContentCollection = new DurableObjectStorageCollection<
    AgentLocalDocumentKey,
    // NOTE(calebmer): We still support `ApiContentResponse` in the collection for
    // backwards compatibility purposes. After deploying this change and all ChatGPT
    // agent durable objects reset their storage we should be able to drop
    // `ApiContentResponse` from this union.
    ApiContentResponse | {title: string; content: ApiContentResponse}
>("a5");

export async function putAgentLocalDocumentContent(
    storage: DurableObjectStorageInterface,
    documentId: DocumentId,
    document: {title: string; content: ApiContentResponse},
) {
    let dedupeNumber = 1;
    let documentKey: AgentLocalDocumentKey = `/local/document/${documentId}-${dedupeNumber}`;

    while (true) {
        const existingData = await AgentLocalDocumentContentCollection.get(storage, documentKey);
        if (existingData === undefined) break;

        dedupeNumber += 1;
        documentKey = `/local/document/${documentId}-${dedupeNumber}`;
    }
    await AgentLocalDocumentContentCollection.put(storage, documentKey, document);
    return documentKey;
}

export async function getAgentLocalDocumentContentIfExists(
    storage: DurableObjectStorageInterface,
    documentKey: AgentLocalDocumentKey,
): Promise<{title: string; content: ApiContentResponse} | null> {
    const documentContent = await AgentLocalDocumentContentCollection.get(storage, documentKey);
    if (!documentContent) return null;

    return {
        title: hasOwnProperty(documentContent, "title") ? documentContent.title : "",
        content: hasOwnProperty(documentContent, "title")
            ? documentContent.content
            : documentContent,
    };
}
