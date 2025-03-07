import {fromDate, toCalendarDate} from "@internationalized/date";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {TaskPersonalView} from "~/client/tasks/task_personal_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    initialGridViewExpansionStates: Schema.tuple([
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
        TaskGridViewExpansionStateSchema,
    ]),
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "My tasks"}]);

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const currentTime = new Date();
    const currentZonedDateTime = fromDate(currentTime, context.loader.getClientInfo().timeZone);
    const currentDate = toCalendarDate(currentZonedDateTime);

    const assigneeFilter: TaskQueryAccountNormalizedFilter = {
        type: "OneOf",
        accountIds: assertNonEmptyReadonlySet(new Set([context.actor.getAccountId()])),
    };

    const assigneeActiveQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            assigneeFilter,
            displayStatusFilter: {
                ifOpenInactive: false,
                ifOpenActive: true,
                ifClosed: false,
            },
        },
        sorts: [
            {
                type: "AssigneeActivePosition",
                direction: "Descending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const assigneeOverdueQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            assigneeFilter,
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: false,
                ifClosed: false,
            },
            dueDateFilter: {
                type: "Range",
                exclusiveLowerBoundDate: currentDate,
                exclusiveUpperBoundDate: null,
            },
        },
        // NOCOMMIT:
        sorts: [
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const assigneeDueTodayQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            assigneeFilter,
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: false,
                ifClosed: false,
            },
            dueDateFilter: {
                type: "Range",
                exclusiveLowerBoundDate: currentDate.subtract({days: 1}),
                exclusiveUpperBoundDate: currentDate.add({days: 1}),
            },
        },
        // NOCOMMIT:
        sorts: [
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const assigneeDueSoonQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            assigneeFilter,
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: false,
                ifClosed: false,
            },
            dueDateFilter: {
                type: "Range",
                exclusiveLowerBoundDate: currentDate,
                exclusiveUpperBoundDate: currentDate.add({days: 7}),
            },
        },
        // NOCOMMIT:
        sorts: [
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const assigneeRemainingQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

        filters: {
            assigneeFilter,
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: false,
                ifClosed: false,
            },
            dueDateFilter: {
                type: "RangeOrIsEmpty",
                exclusiveLowerBoundDate: currentDate.add({days: 6}),
                exclusiveUpperBoundDate: null,
            },
        },
        // NOCOMMIT:
        sorts: [
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const {queries, extraQueries, updateEvent} = await context.tasks.loadQueries(spaceId, {
        queries: [
            assigneeActiveQuery,
            assigneeOverdueQuery,
            assigneeDueTodayQuery,
            assigneeDueSoonQuery,
            assigneeRemainingQuery,
        ],
        taskIds: [],
        collectionIds: [],
    });

    const assigneeActiveQueryOutput = assertExists(queries[0]);
    const assigneeOverdueQueryOutput = assertExists(queries[1]);
    const assigneeDueTodayQueryOutput = assertExists(queries[2]);
    const assigneeDueSoonQueryOutput = assertExists(queries[3]);
    const assigneeRemainingQueryOutput = assertExists(queries[4]);

    return jsonWithSchema(
        LoaderSchema,
        {
            initialGridViewExpansionStates: [
                assigneeActiveQueryOutput.gridViewExpansionState,
                assigneeOverdueQueryOutput.gridViewExpansionState,
                assigneeDueTodayQueryOutput.gridViewExpansionState,
                assigneeDueSoonQueryOutput.gridViewExpansionState,
                assigneeRemainingQueryOutput.gridViewExpansionState,
            ],
        },
        {
            taskStoreLoaderData: {
                queries: [
                    {
                        limit: assigneeActiveQuery.limit,
                        filters: assigneeActiveQuery.filters,
                        sorts: assigneeActiveQuery.sorts,
                        loadedState: assigneeActiveQueryOutput.loadedState,
                    },
                    {
                        limit: assigneeOverdueQuery.limit,
                        filters: assigneeOverdueQuery.filters,
                        sorts: assigneeOverdueQuery.sorts,
                        loadedState: assigneeOverdueQueryOutput.loadedState,
                    },
                    {
                        limit: assigneeDueTodayQuery.limit,
                        filters: assigneeDueTodayQuery.filters,
                        sorts: assigneeDueTodayQuery.sorts,
                        loadedState: assigneeDueTodayQueryOutput.loadedState,
                    },
                    {
                        limit: assigneeDueSoonQuery.limit,
                        filters: assigneeDueSoonQuery.filters,
                        sorts: assigneeDueSoonQuery.sorts,
                        loadedState: assigneeDueSoonQueryOutput.loadedState,
                    },
                    {
                        limit: assigneeRemainingQuery.limit,
                        filters: assigneeRemainingQuery.filters,
                        sorts: assigneeRemainingQuery.sorts,
                        loadedState: assigneeRemainingQueryOutput.loadedState,
                    },
                    ...extraQueries,
                ],
                taskIds: [],
                collectionIds: [],
                updateEvent,
            },
        },
    );
}

export default function TasksRoute() {
    const {initialGridViewExpansionStates} = useLoaderDataWithSchema(LoaderSchema);

    // We don't retain here since the components that consume our queries are
    // expected to retain them.
    const {
        store,
        queries: [
            assigneeActiveQuery,
            assigneeOverdueQuery,
            assigneeDueTodayQuery,
            assigneeDueSoonQuery,
            assigneeRemainingQuery,
        ],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(
        assigneeActiveQuery &&
            assigneeOverdueQuery &&
            assigneeDueTodayQuery &&
            assigneeDueSoonQuery &&
            assigneeRemainingQuery,
    );

    const [
        initialAssigneeActiveGridViewExpansionState,
        initialAssigneeOverdueGridViewExpansionState,
        initialAssigneeDueTodayGridViewExpansionState,
        initialAssigneeDueSoonGridViewExpansionState,
        initialAssigneeRemainingGridViewExpansionState,
    ] = initialGridViewExpansionStates;

    // NOCOMMIT: Should be `TaskPersonal` not `TaskNotepad`.
    const affinityManager = useTaskClientStoreSearchAffinityManager("TaskNotepad");

    return (
        <TaskGridViewDndContext store={store}>
            <TaskPersonalView
                store={store}
                assigneeActiveQuery={{
                    query: assigneeActiveQuery,
                    initialGridViewExpansionState: initialAssigneeActiveGridViewExpansionState,
                }}
                assigneeOverdueQuery={{
                    query: assigneeOverdueQuery,
                    initialGridViewExpansionState: initialAssigneeOverdueGridViewExpansionState,
                }}
                assigneeDueTodayQuery={{
                    query: assigneeDueTodayQuery,
                    initialGridViewExpansionState: initialAssigneeDueTodayGridViewExpansionState,
                }}
                assigneeDueSoonQuery={{
                    query: assigneeDueSoonQuery,
                    initialGridViewExpansionState: initialAssigneeDueSoonGridViewExpansionState,
                }}
                assigneeRemainingQuery={{
                    query: assigneeRemainingQuery,
                    initialGridViewExpansionState: initialAssigneeRemainingGridViewExpansionState,
                }}
                affinityManager={affinityManager}
            />
        </TaskGridViewDndContext>
    );
}
