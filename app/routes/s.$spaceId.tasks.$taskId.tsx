import {useEffect} from "react";
import {Params, useParams} from "react-router";
import {useTaskClientStoreSearchEntityAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {Box} from "~/client/design/box.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDetailView, taskDetailViewMaxWidth} from "~/client/tasks/task_detail_view.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId, isId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferencesSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskRealtimeUpdateEventBackfillTask} from "~/shared/tasks/task_realtime_protocol.js";

const LoaderSchema = Schema.object({
    initialMetaTitleText: Schema.string,
    childrenGridViewExpansionState: TaskGridViewExpansionStateSchema,
    initialBottomGhostTaskId: Schema.id<TaskId>(),
    notesVersion: Schema.integer,
    notesContent: TaskNotesContentWithReferencesSchema,
});

export const meta = createMetaFunction(LoaderSchema, ({data: {initialMetaTitleText}}) => [
    {title: addFallbackToTaskTitle(initialMetaTitleText)},
]);

export async function loader({params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const taskId = Schema.id<TaskId>().deserialize(params.taskId ?? null);

    const childrenQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: true,
            },
            parentFilter: {
                parentTaskId: taskId,
            },
        },
        sorts: [
            {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],

        shouldLoadGridViewExpandedChildTasksForBrowserId: context.loader.getBrowserId(),
    };

    const [{queries, extraQueries, updateEvent}, {version: notesVersion, content: notesContent}] =
        await runAllPromises([
            context.tasks.loadQueries(spaceId, {
                queries: [childrenQuery],
                taskIds: [taskId],
                collectionIds: [],
            }),
            getTaskNotesContent(context, taskId),
        ]);

    const backfillTask = updateEvent.backfillTasks.find(
        (
            backfillTask,
        ): backfillTask is TaskRealtimeUpdateEventBackfillTask & {type: "Authorized"} =>
            backfillTask.type === "Authorized" && backfillTask.task.id === taskId,
    );
    const childrenQueryOutput = assertExists(queries[0]);

    return jsonWithSchema(
        LoaderSchema,
        {
            initialMetaTitleText: backfillTask?.task.getTitle().getText() ?? "",
            childrenGridViewExpansionState: childrenQueryOutput.gridViewExpansionState,
            initialBottomGhostTaskId: generateId<TaskId>(),
            notesVersion,
            notesContent,
        },
        {
            propagateEventData: {
                context: {taskId},
            },
            taskStoreLoaderData: {
                queries: [
                    {
                        limit: childrenQuery.limit,
                        filters: childrenQuery.filters,
                        sorts: childrenQuery.sorts,
                        loadedState: childrenQueryOutput.loadedState,
                    },
                    ...extraQueries,
                ],
                taskIds: [taskId],
                collectionIds: [],
                updateEvent,
            },
        },
    );
}

export async function clientLoader({
    data,
    params,
}: {
    data: SchemaSerializedObjectValue;
    params: Params<string>;
}) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    clientLoaderTaskStoreLoaderData(spaceId, data);
}

export default function TaskRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const {taskId} = useParams();
    assert(taskId && isId<TaskId>(taskId));

    const {
        childrenGridViewExpansionState,
        initialBottomGhostTaskId,
        notesVersion: initialNotesVersion,
        notesContent: initialNotesContent,
    } = useLoaderDataWithSchema(LoaderSchema);
    const {
        queries: [childrenQuery],
        taskSubscriptions: [taskSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(childrenQuery && taskSubscription);

    // Retain our queries so they aren't destroyed while we're using them.
    useEffect(() => {
        childrenQuery.retain();
        taskSubscription.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    childrenQuery.release();
                    taskSubscription.release();
                });
            });
        };
    }, [childrenQuery, taskSubscription]);

    const updateMetaTitle = useUpdateMetaTitle();

    // Update our document's title whenever the task's title changes.
    useEffect(() => {
        const update = () => {
            updateMetaTitle(
                `${addFallbackToTaskTitle(
                    taskSubscription.taskEntryStore.getSnapshot().task?.getTitle().getText() ?? "",
                )}${metaTitlePostfix}`,
            );
        };

        update();
        return taskSubscription.taskEntryStore.subscribe(update);
    }, [taskSubscription.taskEntryStore, updateMetaTitle]);

    const affinityManager = useTaskClientStoreSearchEntityAffinityManager(`Task:${taskId}`);

    return (
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="0"
            display="flex"
            justifyContent="center"
            padding={!withMobileLayout ? {desktop: "4"} : undefined}
        >
            <Box
                width="full"
                maxWidth={taskDetailViewMaxWidth}
                overflow="hidden"
                borderRadius={!withMobileLayout ? {desktop: "md"} : undefined}
                boxShadow={!withMobileLayout ? {desktop: "elevation-5"} : undefined}
                backgroundColor="grey-0"
            >
                <TaskGridViewDndContext store={taskSubscription.store}>
                    <TaskDetailView
                        // Remount when the `TaskId` changes.
                        key={taskSubscription.taskId}
                        taskSubscription={taskSubscription}
                        childrenQuery={childrenQuery}
                        affinityManager={affinityManager}
                        initialChildrenGridViewExpansionState={childrenGridViewExpansionState}
                        initialBottomGhostTaskId={initialBottomGhostTaskId}
                        initialNotesVersion={initialNotesVersion}
                        initialNotesContent={initialNotesContent}
                    />
                </TaskGridViewDndContext>
            </Box>
        </Box>
    );
}
