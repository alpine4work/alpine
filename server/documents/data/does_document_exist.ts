import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const DocumentExistsCache = new DynamoContextCache<DocumentId, boolean>({
    // Allow sharing this cache because the existence check doesn't depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Check if a document with the given ID exists.
 *
 * This function bypasses authorization checks and is intended for system
 * operations like imports where we need to check if a document already exists
 * before creating it.
 */
export async function doesDocumentExist(
    context: Context<
        DynamoContextModules & {
            actor: SystemActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<boolean> {
    context.actor.authorizeSystem();
    return DocumentExistsCache.get(
        context,
        options?.consistency ?? "Eventual",
        documentId,
        async consistency => {
            const item = await DocumentsTable.getItemIfExists(
                context,
                {
                    partitionType: "Document",
                    sortRangeType: "Attributes",
                    documentId,
                },
                {consistency},
            );
            return item !== null;
        },
    );
}
