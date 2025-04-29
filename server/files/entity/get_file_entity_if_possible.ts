import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {getDocumentContentPreviewIfPossible} from "~/server/documents/data/documents_table.js";
import {getChannelAndMetadataIfPossible} from "~/server/forum/data/forum_table.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {assertNonEmptyReadonlyMap} from "~/shared/tasks/task_query_normalized_filters.js";

export async function getFileEntityIfPossible(
    context: Context<ServerContentActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    entityId: FileEntityId,
): Promise<Result<FileEntityModel, ErrorBase> | null> {
    const entityIdObject = parseFileEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const {documentId} = entityIdObject;

            // NOCOMMIT: Test when you don't have channel access
            const documentResult = await getDocumentContentPreviewIfPossible(context, documentId);
            if (!documentResult?.ok) return documentResult;
            const document = documentResult.value;

            return {
                ok: true,
                value: new FileEntityModel(FileDocumentEntityModelSchema, {
                    type: "Document",
                    id: documentId,
                    version: document.version,
                    titleWithoutFallback: document.titleWithoutFallback,
                    preview: document.preview,
                }),
            };
        }
        case "TaskCollection": {
            const {collectionId} = entityIdObject;

            // NOCOMMIT: Do something with this! Also, if possible?
            await context.tasks.loadQueries(spaceId, {
                taskIds: [],
                collectionIds: [collectionId],
                queries: [
                    {
                        // NOCOMMIT: Proper limit?
                        limit: 10,
                        filters: {
                            displayStatusFilter: {
                                ifOpenActive: true,
                                ifOpenInactive: true,
                                ifClosed: false,
                            },
                            collectionsFilter: assertNonEmptyReadonlyArray([
                                assertNonEmptyReadonlyMap(new Map([[collectionId, false]])),
                            ]),
                        },
                        sorts: [
                            {
                                type: "CollectionPosition",
                                direction: "Ascending",
                                missing: "Last",
                                collectionId,
                            },
                            {
                                type: "CreatedTime",
                                direction: "Ascending",
                                missing: "Last",
                            },
                        ],
                    },
                ],
            });

            return;
        }
        case "Channel": {
            const {channelId} = entityIdObject;

            // NOCOMMIT: Test when you don't have channel access
            const channelQueryResult = await getChannelAndMetadataIfPossible(context, {
                channelId,
                postFilesLimit: 0,
            });
            if (!channelQueryResult?.ok) return channelQueryResult;
            const channelQuery = channelQueryResult.value;

            const channel = assertExists(
                findMapIterable(channelQuery.items, item =>
                    item.model instanceof ChannelModel ? item.model : undefined,
                ),
            );
            const channelContributors = findMapIterable(channelQuery.items, item =>
                item.model instanceof ChannelContributorsModel ? item.model : undefined,
            );

            return {
                ok: true,
                value: new FileEntityModel(FileChannelEntityModelSchema, {
                    type: "Channel",
                    id: channelId,
                    name: channel.name,
                    description: channel.description,
                    contributorCount: channelContributors?.contributorCount ?? 0,
                    topContributors: channelContributors?.topContributors ?? emptyArray,
                }),
            };
        }
        default:
            throw exhaustive(entityIdObject);
    }
}
