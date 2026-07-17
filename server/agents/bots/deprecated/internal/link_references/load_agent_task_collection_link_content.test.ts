import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentTaskCollectionLink} from "~/server/agents/bots/deprecated/internal/link_references/agent_link.js";
import {loadAgentTaskCollectionLinkContent} from "~/server/agents/bots/deprecated/internal/link_references/load_agent_task_collection_link_content.js";
import {printAgentContentMarkdownTree} from "~/server/agents/bots/deprecated/internal/print_api_content_to_agent_markdown.js";
import {
    ApiTaskCollection,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

const tracer = new TracerContextModule(testTracer);
const tracerRoot = tracer.getRoot();

function mockGetTaskCollection(
    api: ApiClientMock,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
    responseData: Partial<Omit<ApiTaskCollection, "id">>,
): void {
    api.mockGet("/task-collections/{id}", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: responseData.name ?? "Test Task Collection",
                defaults: {filters: [], sorts: []},
            },
        },
    });
}

function mockGetTaskCollectionTasks(
    api: ApiClientMock,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
    responseData: {
        totalTaskCount?: number;
        nextCursor?: ApiTaskQueryCursor | null;
        tasks?: Array<
            PartialBy<ApiTaskResponse, Exclude<keyof ApiTaskResponse, "id" | "status" | "title">>
        >;
    },
    queryParams?: {
        limit?: number;
        cursor?: string | null;
        status?: Array<"Open" | "Closed">;
    },
): void {
    const params = queryParams
        ? {
              path: {id: collectionId},
              query: queryParams,
          }
        : "Any";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: params === "Any" ? params : {path: params.path},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Test Task Collection",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: responseData.nextCursor ?? null,
            tasks: (responseData.tasks ?? []).map((task, index) => ({
                cursor: `test-task-cursor-${index}` as ApiTaskQueryCursor,
                task: {
                    collections: [],
                    subtasks: {openTaskCount: 0, closedTaskCount: 0},
                    ...task,
                },
            })),
        },
    });
}

describe("loadAgentTaskCollectionLinkContent", () => {
    const spaceId = generateId<SpaceId>();
    const client = new ApiClientMock();
    const request = {
        apiClient: client,
        spaceId,
    };

    const aliceAccount = createApiAccountMock({
        name: "Alice",
    });
    const bobAccount = createApiAccountMock({
        name: "Bob",
    });

    test("loads task collection with open active and inactive tasks", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Sprint Tasks",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [
                {
                    id: generateId(),
                    title: "Active Task",
                    status: {type: "Open", isActive: true},
                },
                {
                    id: generateId(),
                    title: "Inactive Task",
                    status: {type: "Open", isActive: false},
                },
            ],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Sprint Tasks",
            statusesFilter: new Set(["Open"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are the Open tasks in the Sprint Tasks collection. \
See [here for Closed tasks](/task-collection/sprint-tasks-closed-tasks) in this collection.

1. [Active Task (Open)](/task/active-task)

   - Status: Open (Active)

2. [Inactive Task (Open)](/task/inactive-task)

   - Status: Open (Inactive)
`);
    });

    test("loads task collection with tasks including all metadata", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Detailed Tasks",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [
                {
                    id: generateId(),
                    title: "Task with All Fields",
                    status: {type: "Open", isActive: true},
                    assignee: aliceAccount,
                    due: {date: "2025-12-31"},
                    priority: {type: "Urgent"},
                },
                {
                    id: generateId(),
                    title: "Task with Some Fields",
                    status: {type: "Open", isActive: false},
                    assignee: bobAccount,
                    priority: {type: "High"},
                },
            ],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Detailed Tasks",
            statusesFilter: new Set(["Open"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are the Open tasks in the Detailed Tasks collection. See \
[here for Closed tasks](/task-collection/detailed-tasks-closed-tasks) in this collection.

1. [Task with All Fields (Open)](/task/task-with-all-fields)

   - Status: Open (Active)

   - Assignee: [Alice](/account/alice)

   - Due: 2025-12-31

   - Priority: Urgent

2. [Task with Some Fields (Open)](/task/task-with-some-fields)

   - Status: Open (Inactive)

   - Assignee: [Bob](/account/bob)

   - Priority: High
`);
    });

    test("loads task collection with only closed tasks", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Completed Work",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [
                {
                    id: generateId(),
                    title: "Completed Task 1",
                    status: {type: "Closed"},
                },
                {
                    id: generateId(),
                    title: "Completed Task 2",
                    status: {type: "Closed"},
                    assignee: aliceAccount,
                },
            ],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Completed Work",
            statusesFilter: new Set(["Closed"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are the Closed tasks in the Completed Work collection. See \
[here for Open tasks](/task-collection/completed-work-open-tasks) in this collection.

1. [Completed Task 1 (Closed)](/task/completed-task-1)

   - Status: Closed

2. [Completed Task 2 (Closed)](/task/completed-task-2)

   - Status: Closed

   - Assignee: [Alice](/account/alice)
`);
    });

    test("loads task collection with all statuses", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "All Tasks",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [
                {
                    id: generateId(),
                    title: "Active Task",
                    status: {type: "Open", isActive: true},
                },
                {
                    id: generateId(),
                    title: "Closed Task",
                    status: {type: "Closed"},
                },
            ],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "All Tasks",
            statusesFilter: new Set(["Open", "Closed"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are all of the tasks in the All Tasks collection.

1. [Active Task (Open)](/task/active-task)

   - Status: Open (Active)

2. [Closed Task (Closed)](/task/closed-task)

   - Status: Closed
`);
    });

    test("loads task collection with open task filter but no open tasks", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Empty Collection",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Empty Collection",
            statusesFilter: new Set(["Open"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
There aren\u2019t any Open tasks in the Empty Collection collection.
`);
    });

    test("loads empty task collection", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Empty Collection",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Empty Collection",
            statusesFilter: new Set(["Open", "Closed"]),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(
            `There aren\u2019t any tasks in the Empty Collection collection.\n`,
        );
    });

    test("loads open tasks only when statuses filter is empty", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Sprint Tasks",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [
                {
                    id: generateId(),
                    title: "Active Task",
                    status: {type: "Open", isActive: true},
                },
                {
                    id: generateId(),
                    title: "Inactive Task",
                    status: {type: "Open", isActive: false},
                },
            ],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Sprint Tasks",
            statusesFilter: new Set(),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are the Open tasks in the Sprint Tasks collection. \
See [here for Closed tasks](/task-collection/sprint-tasks-closed-tasks) in this collection.

1. [Active Task (Open)](/task/active-task)

   - Status: Open (Active)

2. [Inactive Task (Open)](/task/inactive-task)

   - Status: Open (Inactive)
`);
    });

    test("loads task collection with empty statuses filter but no open tasks", async () => {
        const collectionId = generateId<TaskCollectionId>();

        mockGetTaskCollection(client, spaceId, collectionId, {
            name: "Empty Collection",
        });

        mockGetTaskCollectionTasks(client, spaceId, collectionId, {
            tasks: [],
            nextCursor: null,
        });

        const link: AgentTaskCollectionLink = {
            type: "TaskCollection",
            collectionId,
            name: "Empty Collection",
            statusesFilter: new Set(),
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentTaskCollectionLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
There aren\u2019t any Open tasks in the Empty Collection collection.
`);
    });
});
