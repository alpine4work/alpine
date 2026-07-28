import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskQueryPagePagination,
    AgentWebTaskQueryPageQuery,
    AgentWebTaskQueryPageTask,
} from "~/server/agents/web/pages/agent_web_task_query_page.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiTaskCollectionReferenceArbitrary,
    ApiTaskReferenceArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {
    ApiTaskPriority,
    ApiTaskQueryFilterResponse,
    ApiTaskQuerySort,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

const ApiTaskPriorityArbitrary: Arbitrary<ApiTaskPriority> = fc.oneof(
    fc.constant({type: "Low"}),
    fc.constant({type: "Medium"}),
    fc.constant({type: "High"}),
    fc.constant({type: "Urgent"}),
);

// An "and n more" count only prints (and parses) after at least one collection
// link, so a non-zero `additionalCollectionsCount` is only generated alongside a
// non-empty `collections` list.
const AgentWebTaskQueryPageTaskCollectionsArbitrary: Arbitrary<
    Pick<AgentWebTaskQueryPageTask, "collections" | "additionalCollectionsCount">
> = fc.oneof(
    fc.constant({collections: [], additionalCollectionsCount: 0}),
    fc.record({
        collections: fc.uniqueArray(ApiTaskCollectionReferenceArbitrary, {
            minLength: 1,
            maxLength: 3,
            selector: collection => collection.id,
        }),
        additionalCollectionsCount: fc.nat({max: 20}),
    }),
);

const AgentWebTaskQueryPageTaskArbitrary: Arbitrary<AgentWebTaskQueryPageTask> = fc
    .tuple(
        fc.record({
            task: ApiTaskReferenceArbitrary,
            isLinked: fc.oneof(
                {weight: 10, arbitrary: fc.constant(true)},
                {weight: 1, arbitrary: fc.constant(false)},
            ),
            parent: fc.oneof(ApiTaskReferenceArbitrary, fc.constant(null)),
            subtasks: fc.record({
                openTaskCount: fc.nat({max: 20}),
                closedTaskCount: fc.nat({max: 20}),
            }),
            assignee: fc.oneof(ApiAccountReferenceArbitrary, fc.constant(null)),
            priority: fc.oneof(ApiTaskPriorityArbitrary, fc.constant(null)),
            dueDateString: fc.oneof(
                ApiContentTextArbitrary.filter(text => text.trim() === text && text.length > 0),
                fc.constant(null),
            ),
        }),
        AgentWebTaskQueryPageTaskCollectionsArbitrary,
    )
    .map(([pageTask, collections]) => {
        const {task, isLinked, ...fields} = pageTask;

        return {
            taskId: isLinked ? task.id : null,
            title: task.title,
            status: task.status,
            ...fields,
            ...collections,
        };
    });

export const AgentWebTaskQueryPageUniqueTasksArbitrary: Arbitrary<
    ReadonlyArray<AgentWebTaskQueryPageTask>
> = fc.uniqueArray(AgentWebTaskQueryPageTaskArbitrary, {
    selector: task => task.taskId ?? task.title,
});

export const AgentWebTaskQueryPageUniqueSubtasksArbitrary =
    AgentWebTaskQueryPageUniqueTasksArbitrary.map(tasks =>
        tasks.map(task => ({...task, parent: null})),
    );

const ApiTaskQueryFilterResponsesArbitrary: Arbitrary<ReadonlyArray<ApiTaskQueryFilterResponse>> =
    fc.constantFrom(
        [],
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
        ],
        [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: [{type: "High"}, {type: "Medium"}],
                },
            },
        ],
        [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: [{type: "Closed"}]},
            },
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    time: {type: "AbsoluteDate", date: "2026-07-12"},
                },
            },
        ],
        [{type: "Title", operation: {type: "Includes", titleQuery: "launch plan"}}],
    );

const ApiTaskQuerySortsArbitrary: Arbitrary<ReadonlyArray<ApiTaskQuerySort>> = fc.constantFrom(
    [],
    [
        {type: "Priority", direction: "Descending"},
        {type: "Due", direction: "Ascending"},
    ],
    [{type: "CreatedTime", direction: "Ascending"}],
);

export const AgentWebTaskQueryPageQueryArbitrary: Arbitrary<AgentWebTaskQueryPageQuery> = fc.record(
    {
        filters: ApiTaskQueryFilterResponsesArbitrary,
        sorts: ApiTaskQuerySortsArbitrary,
    },
);

export const AgentWebTaskQueryPagePaginationArbitrary: Arbitrary<AgentWebTaskQueryPagePagination> =
    fc.record({
        nextCursorHash: fc
            .integer({min: 0, max: 0xffffff})
            .map(hashNumber => hashNumber.toString(16).padStart(6, "0")),
        query: AgentWebTaskQueryPageQueryArbitrary,
    });
