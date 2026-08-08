import {DocAttrStep} from "prosemirror-transform";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {dangerouslyGetSiteAccessPolicyWithoutAuthorization} from "~/server/sites/data/dangerously_get_site_access_policy_without_authorization.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    SiteItemSearchEntityId,
    parseSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function removeEntityFromSite(
    context: ServerSessionActionContext,
    input: {
        siteId: SiteId;
        spaceId: SpaceId;
        entityId: SiteItemSearchEntityId;
    },
): Promise<{
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    // When removing an entity from a site, we copy the site's local access policy into
    // the entity.
    //
    // IMPORTANT: We don't need to authorize here since we will authorize that the
    // actor has Manage access on the site within `validateAccessPolicyUpdateForServer`
    // before allowing them to remove the entity from the site.
    const newAccessPolicy = await dangerouslyGetSiteAccessPolicyWithoutAuthorization(
        context,
        input.siteId,
        {
            consistency: "StrongWithinCache",
        },
    );
    const entity = parseSiteItemSearchEntityId(input.entityId);

    const result = await runRemoveEntityFromSiteByEntityType(
        context,
        input,
        entity,
        newAccessPolicy,
    );

    context.process.waitUntil(
        markSearchAffinityEntityInteraction(context, {
            spaceId: input.spaceId,
            entityId: `Site:${input.siteId}`,
            interaction: {type: "MediumIntentUpdate"},
            siteId: null,
        }),
    );

    return result;
}

async function runRemoveEntityFromSiteByEntityType(
    context: ServerSessionActionContext,
    input: {
        siteId: SiteId;
        spaceId: SpaceId;
        entityId: SiteItemSearchEntityId;
    },
    entity: ReturnType<typeof parseSiteItemSearchEntityId>,
    newAccessPolicy: LocalAccessPolicy,
): Promise<{
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    switch (entity.type) {
        case "Channel": {
            // TODO(#sites): Also return the channel's own update events so clients subscribed
            // to the channel see the access policy flip.
            return await updateChannelAccessPolicy(context, {
                channelId: entity.channelId,
                accessPolicy: newAccessPolicy,
                notification: null,
            });
        }
        case "Chat": {
            return await updateRoomChatAccessPolicy(context, {
                chatId: entity.chatId,
                accessPolicy: newAccessPolicy,
                notification: null,
            });
        }
        case "Task": {
            const {getRynamoEventsForSite} = await commitTaskActionTransaction(
                context.actor.authorizeSession(),
                input.spaceId,
                [
                    {
                        type: "UpdateTask",
                        time: [Date.now(), 0],
                        taskId: entity.taskId,
                        taskAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: newAccessPolicy,
                        },
                    },
                ],
            );
            return {
                getRynamoEventsForSite,
            };
        }
        case "TaskCollection": {
            const {getRynamoEventsForSite} = await commitTaskActionTransaction(
                context.actor.authorizeSession(),
                input.spaceId,
                [
                    {
                        type: "UpdateCollection",
                        time: [Date.now(), 0],
                        collectionId: entity.collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: newAccessPolicy,
                        },
                    },
                ],
            );

            return {
                getRynamoEventsForSite,
            };
        }
        case "Document": {
            // Documents store their access policy as a top-level ProseMirror node attribute,
            // so removing a document from a site is implemented by:
            //
            // 1. Constructing a `DocAttrStep` that updates the doc's `accessPolicy` attribute
            //    back to the site's local policy.
            // 2. Sending the step to the document's collaboration durable object via the
            //    `/update-content-without-optimistic-broadcast` HTTP route, which persists the
            //    document write before broadcasting steps to connected clients.
            // 3. Setting `intentionallyUpdateAccessPolicy` so `updateDocumentContent`
            //    recognizes this as an intentional access policy change and clears the site
            //    entity ref in the same dynamo transaction.
            // 4. Reading the `eventsForSite` field of the response to surface site sidebar
            //    events back here.
            //
            // We pass `version: 0`. The DO's content manager rebases whatever steps we send
            // against its tracked version. A `DocAttrStep` rebases cleanly against any
            // concurrent `ReplaceStep`s (they don't interact), so version 0 is safe and avoids
            // an extra round-trip to read the current version first.
            const {eventsForSite} =
                DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.outputSchema.deserialize(
                    await context.edge.sendRequestToDurableObject(
                        `/api/durable-objects/documents/${entity.documentId}/update-content-without-optimistic-broadcast`,
                        {
                            serviceName: "DocumentCollaborationService",
                            route: "/api/durable-objects/documents/:documentId/update-content-without-optimistic-broadcast",
                            body: DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.inputSchema.serialize(
                                {
                                    version: null,
                                    steps: [new DocAttrStep("accessPolicy", newAccessPolicy)],
                                    clientId: generateId(),
                                    createCommentThreads: [],
                                    intentionallyUpdateAccessPolicy: {
                                        accessPolicy: newAccessPolicy,
                                        notification: null,
                                    },
                                    intentionallyUpdateDeletedTime: null,
                                    updateOurPresenceState: {
                                        state: null,
                                    },
                                },
                            ),
                        },
                    ),
                );
            return {
                getRynamoEventsForSite: async () => eventsForSite,
            };
        }
        default:
            throw exhaustive(entity);
    }
}
