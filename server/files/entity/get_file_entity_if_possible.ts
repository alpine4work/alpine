import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {
    createDocumentNotFoundError,
    getDocumentContentPreviewIfPossible,
} from "~/server/documents/data/documents_table.js";
import {
    createChannelNotFoundError,
    getChannelAndMetadataIfPossible,
    isSubscribedToChannel,
} from "~/server/forum/data/forum_table.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {Context} from "~/shared/context/context.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {ErrorBase, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeLoadQueriesOutput} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

export async function getFileEntityIfPossible(
    context: Context<ServerContentActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    entityId: FileEntityId,
): Promise<Result<FileEntityModel, ErrorBase>> {
    const entityIdObject = parseFileEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const {documentId} = entityIdObject;

            const documentResult = await getDocumentContentPreviewIfPossible(context, documentId);

            if (!documentResult) return {ok: false, error: createDocumentNotFoundError(documentId)};

            if (!documentResult.ok) return documentResult;
            const document = documentResult.value;

            return {
                ok: true,
                value: new FileEntityModel(FileDocumentEntityModelSchema, {
                    type: "Document",
                    // Always prefer the model with the higher preview version. If the preview
                    // version is the same then use the document version (only applies to the
                    // title).
                    versions: [document.preview?.version ?? -1, document.version],
                    id: documentId,
                    version: document.version,
                    titleWithoutFallback: document.titleWithoutFallback,
                    preview: document.preview,
                }),
            };
        }
        case "TaskCollection": {
            const {collectionId} = entityIdObject;

            const filters: TaskQueryNormalizedFilters = {
                displayStatusFilter: {
                    ifOpenActive: true,
                    ifOpenInactive: true,
                    ifClosed: false,
                },
                collectionsFilter: assertNonEmptyReadonlyArray([
                    assertNonEmptyReadonlyMap(new Map([[collectionId, false]])),
                ]),
            };

            const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
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
            ];

            const result: Result<TaskRealtimeLoadQueriesOutput, ErrorBase> = await context.tasks
                .loadQueries(spaceId, {
                    taskIds: [],
                    collectionIds: [collectionId],
                    queries: [{limit: 8, filters, sorts}],
                })
                .then(
                    result => ({ok: true, value: result}),
                    error => {
                        // Normally, we prefer that functions explicitly return authorization errors
                        // instead of us using a try/catch which might pick up an unrelated permission
                        // error. However, in this case the `loadQueries()` function in
                        // `TaskRealtimeService` is complex enough that we're not going to bother
                        // updating its code to return explicit authorization errors for now.
                        if (
                            (error instanceof PermissionDeniedError ||
                                error instanceof NotFoundError) &&
                            error.displayMessage
                        ) {
                            return {ok: false, error};
                        } else {
                            throw error;
                        }
                    },
                );

            if (!result.ok) return result;

            const tasksAndCursors: Array<{
                readonly cursor: TaskQuerySortCursor;
                readonly task: TaskModel;
            }> = [];

            for (const backfillTask of result.value.updateEvent.backfillTasks) {
                if (backfillTask.type !== "Authorized") continue;
                const {task} = backfillTask;

                if (!evaluateTaskQueryNormalizedFiltersForModel(filters, task)) continue;

                const cursor = getTaskQueryNormalizedSortCursorForModel(sorts, task);
                tasksAndCursors.push({cursor, task});
            }

            // Make sure our tasks are sorted properly...
            tasksAndCursors.sort((task1, task2) =>
                compareTaskQuerySortCursors(sorts, task1.cursor, task2.cursor),
            );

            const backfillCollection = assertExists(
                result.value.updateEvent.backfillCollections.find(backfillCollection => {
                    switch (backfillCollection.type) {
                        case "Authorized":
                            return backfillCollection.collection.id === collectionId;
                        case "Unauthorized":
                            return backfillCollection.collectionId === collectionId;
                        default:
                            throw exhaustive(backfillCollection);
                    }
                }),
            );

            // If we don't have access to the collection then `loadQueries()` should throw
            // a `PermissionDeniedError`.
            assert(backfillCollection.type !== "Unauthorized");

            let maxTime = zeroHybridLogicalTime;

            const clock = {
                tick: (time: HybridLogicalTime) => {
                    if (compareHybridLogicalTimes(maxTime, time) < 0) {
                        maxTime = time;
                    }
                },
            };

            // TODO(calebmer): We keep rendering deleted task collections! We should show
            // an error message instead.
            const collection = backfillCollection.collection;
            collection.tick(clock);

            const tasks = tasksAndCursors.map(({task}) => {
                task.tick(clock);
                return task;
            });

            return {
                ok: true,
                value: new FileEntityModel(FileTaskCollectionEntityModelSchema, {
                    type: "TaskCollection",
                    // We use the max `HybridLogicalTime` across all the CRDTs we're
                    // returning as the version. While this isn't perfect (when merging two file
                    // entities one may have a newer collection name and the other may have a newer
                    // collection color) we consider it good enough. Most of the time we'll be
                    // reading the latest data.
                    versions: maxTime,
                    collection,
                    previewTasks: tasks,
                }),
            };
        }
        case "Channel": {
            const {channelId} = entityIdObject;

            const [channelQueryResult, isSubscribedResult] = await runAllPromises([
                getChannelAndMetadataIfPossible(context, {
                    channelId,
                    postFilesLimit: 0,
                }),
                context.actor.type === "Session"
                    ? captureResultPromise(
                          isSubscribedToChannel(context.actor.authorizeSession(), channelId),
                      )
                    : null,
            ]);

            if (!channelQueryResult)
                return {ok: false, error: createChannelNotFoundError(channelId)};

            if (!channelQueryResult.ok) return channelQueryResult;
            const channelQuery = channelQueryResult.value;

            // Only throw error from `isSubscribedToChannel()` if we're authorized to view
            // the channel.
            const isSubscribed = isSubscribedResult ? unwrapResult(isSubscribedResult) : false;

            const channel = assertExists(
                findMapIterable(channelQuery.items, item =>
                    item.model instanceof ChannelModel
                        ? (item as {readonly version: number; readonly model: ChannelModel})
                        : undefined,
                ),
            );
            const channelContributors = findMapIterable(channelQuery.items, item =>
                item.model instanceof ChannelContributorsModel ? item.model : undefined,
            );

            return {
                ok: true,
                value: new FileEntityModel(FileChannelEntityModelSchema, {
                    type: "Channel",
                    versions: [channel.version],
                    id: channelId,
                    createdTime: channel.model.createdTime,
                    name: channel.model.name,
                    description: channel.model.description,
                    isSubscribed,
                    contributorCount: channelContributors?.contributorCount ?? 0,
                    topContributors: channelContributors?.topContributors ?? emptyArray,
                }),
            };
        }
        default:
            throw exhaustive(entityIdObject);
    }
}
