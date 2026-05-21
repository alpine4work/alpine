import {DocAttrStep} from "prosemirror-transform";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicy} from "~/server/forum/data/update_channel_access_policy.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/task_table.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    SiteItemSearchEntityId,
    parseSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function addEntityToSite(
    context: ServerSessionActionContext,
    input: {
        siteId: SiteId;
        spaceId: SpaceId;
        entityId: SiteItemSearchEntityId;
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
): Promise<{
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    const newAccessPolicy = {
        type: "Site",
        siteId: input.siteId,
        position: {
            parentId: input.parentId,
            orderKey: input.orderKey,
        },
    } as const;

    const entity = parseSiteItemSearchEntityId(input.entityId);

    const result = await runAddEntityToSiteByEntityType(context, input, entity, newAccessPolicy);

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

async function runAddEntityToSiteByEntityType(
    context: ServerSessionActionContext,
    input: {
        siteId: SiteId;
        spaceId: SpaceId;
        entityId: SiteItemSearchEntityId;
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
    entity: ReturnType<typeof parseSiteItemSearchEntityId>,
    newAccessPolicy: {
        type: "Site";
        siteId: SiteId;
        position: {parentId: SiteContainerId; orderKey: OrderKey};
    },
): Promise<{
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    switch (entity.type) {
        case "Channel": {
            // TODO(#sites): Also return the channel's own update events so clients subscribed
            // to the channel see the access policy flip.
            return updateChannelAccessPolicy(context, {
                channelId: entity.channelId,
                accessPolicy: newAccessPolicy,
                notification: null,
            });
        }
        case "Chat": {
            return updateRoomChatAccessPolicy(context, {
                chatId: entity.chatId,
                accessPolicy: newAccessPolicy,
                notification: null,
            });
        }
        case "Task": {
            const {getRynamoEventsForSite} = await commitTaskActionTransaction(
                context,
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
                context,
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
            // so adding a document to a site is implemented by:
            //
            // 1. Constructing a `DocAttrStep` that updates the doc's `accessPolicy` attribute
            //    to a `Site` policy.
            // 2. Sending the step to the document's collaboration durable object via the
            //    `/update-content-without-optimistic-broadcast` HTTP route, which persists the
            //    document write before broadcasting steps to connected clients.
            // 3. Setting `intentionallyUpdateAccessPolicy` (with `sitePosition`) so
            //    `updateDocumentContent` recognizes this as an intentional access policy
            //    change and writes the site entity ref in the same dynamo transaction.
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
                        // TODO(#sites): Switch this to `/update-content-without-optimistic-broadcast` once
                        // durable object has been deployed.
                        `/api/durable-objects/documents/${entity.documentId}/put-content-without-optimistic-broadcast`,
                        {
                            serviceName: "DocumentCollaborationService",
                            // TODO(#sites): Switch this to `/update-content-without-optimistic-broadcast` once
                            // durable object has been deployed.
                            route: "/api/durable-objects/documents/:documentId/put-content-without-optimistic-broadcast",
                            body: DocumentCollaborationProtocol.procedureSchemas.updateContentWithoutOptimisticBroadcast.inputSchema.serialize(
                                {
                                    version: null,
                                    steps: [
                                        new DocAttrStep("accessPolicy", {
                                            type: "Site",
                                            siteId: input.siteId,
                                        }),
                                    ],
                                    clientId: generateId(),
                                    createCommentThreads: [],
                                    intentionallyUpdateAccessPolicy: {
                                        accessPolicy: newAccessPolicy,
                                        notification: null,
                                    },
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
