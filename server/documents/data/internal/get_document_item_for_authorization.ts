import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

type DocumentAttributesItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">;

/**
 * Caches attributes records reused for document authorization during one action.
 */
export const documentItemAuthorizationCache = new DynamoContextCache<
    DocumentId,
    DocumentAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Reads an authorization-ready document attributes record or throws when it is
 * absent.
 */
export async function getDocumentItemForAuthorization(
    context: Context<
        DynamoContextModules & {
            actor: ActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<DocumentAttributesItem> {
    const item = await getDocumentItemForAuthorizationIfExists(context, documentId, options);
    if (!item) throw createDocumentNotFoundError(documentId);
    return item;
}

/**
 * Reads an authorization-ready document attributes record, if it exists.
 *
 * Callers must still authorize the returned document before exposing its data.
 */
export async function getDocumentItemForAuthorizationIfExists(
    context: Context<
        DynamoContextModules & {
            actor: ActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<DocumentAttributesItem | null> {
    return await documentItemAuthorizationCache.get(context, consistency, documentId, consistency =>
        DocumentsTable.getItemIfExists(
            context,
            {
                partitionType: "Document",
                sortRangeType: "Attributes",
                documentId,
            },
            {consistency},
        ),
    );
}
