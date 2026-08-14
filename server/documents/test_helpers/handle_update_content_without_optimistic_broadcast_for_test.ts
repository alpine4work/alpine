import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {
    getDocumentContent,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {Context} from "~/shared/context/context.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Reimplements the one `DocumentCollaborationDurableObject` route that server-side
 * actions reach via `context.edge.sendRequestToDurableObject()`: the
 * `update-content-without-optimistic-broadcast` access-policy update used by
 * `addEntityToSite()` / `removeEntityFromSite()` for documents.
 *
 * Durable objects only run in the spawned edge service, not in the in-process test
 * context (where `sendRequestToDurableObject` is otherwise a no-op stub that
 * returns `undefined`). Without this, adding or removing a document to/from a site
 * fails when the result is deserialized. Wire this as a test context's
 * `sendRequestToDurableObject` so those paths work, applying the change directly
 * against the test database — same approach as `api_documents_paths.test.ts`.
 *
 * Returns `undefined` for any other durable object URL so it can be composed with
 * other handlers.
 */
export async function handleUpdateContentWithoutOptimisticBroadcastForTest(
    context: Context<{}>,
    request: {url: string; body?: SchemaSerializedValue | null},
): Promise<SchemaSerializedValue | undefined> {
    const match = request.url.match(
        /^\/api\/durable-objects\/documents\/([^/]+)\/update-content-without-optimistic-broadcast/,
    );
    if (!match) return undefined;

    const documentId = assertId<DocumentId>(match[1]!);

    // `addEntityToSite()` always runs in an account action context, so this cast is
    // safe.
    const accountContext = context as ServerAccountActionContext;

    const requestBody =
        DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.inputSchema.deserialize(
            request.body ?? null,
        );

    // A `null` version means "apply on top of the latest version". The real durable
    // object rebases the steps against its tracked version; here we read the current
    // version and apply on top of it (the access-policy `DocAttrStep` has nothing
    // concurrent to rebase against).
    const {version} = await getDocumentContent(accountContext, documentId);

    const {newVersion, getRynamoEventsForSite} = await updateDocumentContent(accountContext, {
        id: documentId,
        version: requestBody.version ?? version,
        steps: requestBody.steps,
        clientId: requestBody.clientId,
        intentionallyUpdateAccessPolicy: requestBody.intentionallyUpdateAccessPolicy ?? undefined,
    });

    return DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.outputSchema.serialize(
        {
            newVersion,
            eventsForSite: await getRynamoEventsForSite(accountContext),
        },
    );
}
