import {fromDate, toCalendarDate} from "@internationalized/date";
import {ShouldRevalidateFunction} from "react-router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {TaskPersonalView} from "~/client/tasks/task_personal_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
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
    isFavorite: Schema.boolean,
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "My tasks"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const currentTime = new Date();
    const currentZonedDateTime = fromDate(currentTime, context.loader.getClientInfo().timeZone);
    const currentDate = toCalendarDate(currentZonedDateTime);

    const assigneeFilter: TaskQueryAccountNormalizedFilter = {
        type: "OneOf",
        accountIds: assertNonEmptyReadonlySet(new Set([context.actor.getAccountId()])),
    };

    const activeQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
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
                type: "AssigneePosition",
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

    const overdueQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
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
                exclusiveLowerBoundDate: null,
                exclusiveUpperBoundDate: currentDate,
            },
        },
        sorts: [
            {
                type: "AssigneePosition",
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

    const dueTodayQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
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
        sorts: [
            {
                type: "AssigneePosition",
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

    const dueSoonQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
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
                exclusiveUpperBoundDate: currentDate.add({days: 8}),
            },
        },
        sorts: [
            {
                type: "AssigneePosition",
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

    const remainingQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
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
                exclusiveLowerBoundDate: currentDate.add({days: 7}),
                exclusiveUpperBoundDate: null,
            },
        },
        sorts: [
            {
                type: "AssigneePosition",
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

    const [{queries, extraQueries, updateEvent}, isFavorite] = await runAllPromises([
        context.tasks.loadQueries(spaceId, {
            queries: [activeQuery, overdueQuery, dueTodayQuery, dueSoonQuery, remainingQuery],
            taskIds: [],
            collectionIds: [],
        }),
        isSearchFavoriteEntity(context, {spaceId, entityId: "TaskPersonal"}),
    ]);

    const activeQueryOutput = assertExists(queries[0]);
    const overdueQueryOutput = assertExists(queries[1]);
    const dueTodayQueryOutput = assertExists(queries[2]);
    const dueSoonQueryOutput = assertExists(queries[3]);
    const remainingQueryOutput = assertExists(queries[4]);

    return jsonWithSchema(
        LoaderSchema,
        {
            initialGridViewExpansionStates: [
                activeQueryOutput.gridViewExpansionState,
                overdueQueryOutput.gridViewExpansionState,
                dueTodayQueryOutput.gridViewExpansionState,
                dueSoonQueryOutput.gridViewExpansionState,
                remainingQueryOutput.gridViewExpansionState,
            ],
            isFavorite,
        },
        {
            taskStoreLoaderData: {
                queries: [
                    {
                        limit: activeQuery.limit,
                        filters: activeQuery.filters,
                        sorts: activeQuery.sorts,
                        loadedState: activeQueryOutput.loadedState,
                    },
                    {
                        limit: overdueQuery.limit,
                        filters: overdueQuery.filters,
                        sorts: overdueQuery.sorts,
                        loadedState: overdueQueryOutput.loadedState,
                    },
                    {
                        limit: dueTodayQuery.limit,
                        filters: dueTodayQuery.filters,
                        sorts: dueTodayQuery.sorts,
                        loadedState: dueTodayQueryOutput.loadedState,
                    },
                    {
                        limit: dueSoonQuery.limit,
                        filters: dueSoonQuery.filters,
                        sorts: dueSoonQuery.sorts,
                        loadedState: dueSoonQueryOutput.loadedState,
                    },
                    {
                        limit: remainingQuery.limit,
                        filters: remainingQuery.filters,
                        sorts: remainingQuery.sorts,
                        loadedState: remainingQueryOutput.loadedState,
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

// We don't need to revalidate if the URL doesn't change. We're connected to
// realtime so should receive realtime updates.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export default function TasksRoute() {
    const {initialGridViewExpansionStates, isFavorite} = useLoaderDataWithSchema(LoaderSchema);

    // We don't retain here since the components that consume our queries are
    // expected to retain them.
    const {
        store,
        queries: [activeQuery, overdueQuery, dueTodayQuery, dueSoonQuery, remainingQuery],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(activeQuery && overdueQuery && dueTodayQuery && dueSoonQuery && remainingQuery);

    const [
        initialActiveGridViewExpansionState,
        initialOverdueGridViewExpansionState,
        initialDueTodayGridViewExpansionState,
        initialDueSoonGridViewExpansionState,
        initialRemainingGridViewExpansionState,
    ] = initialGridViewExpansionStates;

    const affinityManager = useTaskClientStoreSearchAffinityManager("TaskPersonal");

    return (
        <TaskGridViewDndContext store={store}>
            <TaskPersonalView
                store={store}
                activeQuery={{
                    query: activeQuery,
                    initialGridViewExpansionState: initialActiveGridViewExpansionState,
                }}
                overdueQuery={{
                    query: overdueQuery,
                    initialGridViewExpansionState: initialOverdueGridViewExpansionState,
                }}
                dueTodayQuery={{
                    query: dueTodayQuery,
                    initialGridViewExpansionState: initialDueTodayGridViewExpansionState,
                }}
                dueSoonQuery={{
                    query: dueSoonQuery,
                    initialGridViewExpansionState: initialDueSoonGridViewExpansionState,
                }}
                remainingQuery={{
                    query: remainingQuery,
                    initialGridViewExpansionState: initialRemainingGridViewExpansionState,
                }}
                affinityManager={affinityManager}
                initialIsFavorite={isFavorite}
            />
        </TaskGridViewDndContext>
    );
}
