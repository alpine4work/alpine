import fc, {Arbitrary} from "fast-check";
import {
    AgentWebTaskCollectionPage,
    AgentWebTaskCollectionPageDefaults,
    AgentWebTaskCollectionPagePagination,
    AgentWebTaskCollectionPageTask,
    apiTaskCollectionColors,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiAccountReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiTaskCollectionReferenceArbitrary,
    ApiTaskReferenceArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {
    ApiTaskPriority,
    ApiTaskQueryFilterResponse,
    ApiTaskQuerySort,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

const ApiTaskPriorityArbitrary: Arbitrary<ApiTaskPriority> = fc.oneof(
    fc.constant({type: "Low"}),
    fc.constant({type: "Medium"}),
    fc.constant({type: "High"}),
    fc.constant({type: "Urgent"}),
);

// An "and n more" count only prints (and parses) after at least one collection
// link, so a non-zero `additionalCollectionsCount` is only generated alongside a
// non-empty `collections` list.
const AgentWebTaskCollectionPageTaskCollectionsArbitrary: Arbitrary<
    Pick<AgentWebTaskCollectionPageTask, "collections" | "additionalCollectionsCount">
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

const AgentWebTaskCollectionPageTaskArbitrary: Arbitrary<AgentWebTaskCollectionPageTask> = fc
    .tuple(
        fc.record({
            task: ApiTaskReferenceArbitrary,
            parent: fc.oneof(ApiTaskReferenceArbitrary, fc.constant(null)),
            assignee: fc.oneof(ApiAccountReferenceArbitrary, fc.constant(null)),
            priority: fc.oneof(ApiTaskPriorityArbitrary, fc.constant(null)),
            dueDateString: fc.oneof(
                ApiContentTextArbitrary.filter(text => text.trim() === text && text.length > 0),
                fc.constant(null),
            ),
        }),
        AgentWebTaskCollectionPageTaskCollectionsArbitrary,
    )
    .map(([pageTask, collections]) => ({...pageTask, ...collections}));

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

const AgentWebTaskCollectionPagePaginationArbitrary: Arbitrary<AgentWebTaskCollectionPagePagination> =
    fc.oneof(
        fc.record({
            nextCursorHash: fc
                .integer({min: 0, max: 0xffffff})
                .map(hashNumber => hashNumber.toString(16).padStart(6, "0")),
            query: fc.record({
                filters: ApiTaskQueryFilterResponsesArbitrary,
                sorts: ApiTaskQuerySortsArbitrary,
            }),
        }),
    );

// Filters that reference accounts or task collections are left to the task query
// filter generative test since they need stored links to print.
const AgentWebTaskCollectionPageDefaultsArbitrary: Arbitrary<AgentWebTaskCollectionPageDefaults | null> =
    fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {
            weight: 1,
            arbitrary: fc
                .record({
                    filters: ApiTaskQueryFilterResponsesArbitrary,
                    sorts: ApiTaskQuerySortsArbitrary,
                })
                .filter(defaults => defaults.filters.length > 0 || defaults.sorts.length > 0),
        },
    );

const AgentWebTaskCollectionHeadPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    subType: fc.constant("Head"),
    name: ApiContentTextArbitrary,
    color: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: fc.constantFrom(...apiTaskCollectionColors)},
    ),
    defaults: AgentWebTaskCollectionPageDefaultsArbitrary,
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskCollectionPagePaginationArbitrary},
    ),
    tasks: fc.array(AgentWebTaskCollectionPageTaskArbitrary),
    isEndOfTasks: fc.boolean(),
});

const AgentWebTaskCollectionTailPageArbitrary: Arbitrary<AgentWebTaskCollectionPage> = fc.record({
    type: fc.constant("TaskCollection"),
    subType: fc.constant("Tail"),
    name: ApiContentTextArbitrary,
    pagination: fc.oneof(
        {weight: 2, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebTaskCollectionPagePaginationArbitrary},
    ),
    tasks: fc.array(AgentWebTaskCollectionPageTaskArbitrary),
    isEndOfTasks: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    pageLink: createIdArbitrary<TaskCollectionId>(),
    page: fc.oneof(
        AgentWebTaskCollectionHeadPageArbitrary,
        AgentWebTaskCollectionTailPageArbitrary,
    ),
});
