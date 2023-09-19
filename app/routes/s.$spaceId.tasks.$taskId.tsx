import {useEffect} from "react";
import {Box} from "~/client/design/box.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskDetailView, taskDetailViewMaxWidth} from "~/client/tasks/task_detail_view.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    initialTitleText: Schema.string,
    childrenGridViewExpandedState: TaskGridViewExpansionStateSchema,
});

export const meta = createMetaFunction(LoaderSchema, ({data: {initialTitleText}}) => [
    {title: addFallbackToTaskTitle(initialTitleText)},
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
                direction: "Descending",
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

    const {queries, extraQueries, updateEvent} = await context.tasks.loadQueries(spaceId, {
        queries: [childrenQuery],
        taskIds: [taskId],
        collectionIds: [],
    });

    const task = updateEvent.backfillAuthorizedTasks.find(task => task.id === taskId);
    const childrenQueryOutput = assertExists(queries[0]);

    return jsonWithSchema(
        LoaderSchema,
        {
            initialTitleText: task?.getTitle().getText() ?? "",
            childrenGridViewExpandedState: childrenQueryOutput.gridViewExpansionState,
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
    const {
        queries: [childrenQuery],
        taskSubscriptions: [taskSubscription],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(childrenQuery && taskSubscription);

    // Retain our queries so they aren't destroyed after
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
                <TaskDetailView
                    // Remount when the `TaskId` changes.
                    key={taskSubscription.taskId}
                    taskSubscription={taskSubscription}
                    childrenQuery={childrenQuery}
                />
            </Box>
        </Box>
    );
}
