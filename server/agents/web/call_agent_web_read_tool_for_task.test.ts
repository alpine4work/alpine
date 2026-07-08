import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiTaskResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_task.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

const emptyNotesContent: ApiContentResponseWithoutKeys = {
    elements: [{type: "Paragraph", elements: []}],
};

function mockGetTask(
    api: ApiClientMock,
    spaceId: SpaceId,
    taskId: TaskId,
    responseData: Omit<ApiTaskResponse, "id">,
): void {
    api.mockGet("/tasks/{id}", {
        params: {path: {id: taskId}},
        data: {
            spaceId,
            task: {
                id: taskId,
                ...responseData,
            },
        },
    });
}

test("reads full task page", async () => {
    const taskId = generateId<TaskId>();
    const parentTaskId = generateId<TaskId>();
    const engineeringCollectionId = generateId<TaskCollectionId>();
    const roadmapCollectionId = generateId<TaskCollectionId>();
    const aliceAccount = createApiAccountMock({name: "Alice"});

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: taskId,
        title: "Ship task page",
        status: {type: "Open", isActive: true},
    });

    mockGetTask(api, spaceId, taskId, {
        title: "Ship task page",
        status: {type: "Open", isActive: true},
        parent: {
            task: {
                id: parentTaskId,
                title: "Parent task",
                status: {type: "Open", isActive: false},
            },
        },
        assignee: aliceAccount,
        collections: [
            {collection: {id: engineeringCollectionId, name: "Engineering"}},
            {collection: {id: roadmapCollectionId, name: "Roadmap"}},
        ],
        priority: {type: "Urgent"},
        due: {date: "2025-07-12"},
        notes: {
            version: 3,
            content: addKeysToApiContentForTest({
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Read rollout notes."}],
                    },
                    {
                        type: "Heading",
                        level: 1,
                        elements: [{type: "Text", text: "Context"}],
                    },
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Ship behind a flag."}],
                    },
                ],
            }),
        },
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/task/ship-task-page",
            limit: "10kb",
        }),
    ).toEqual(`\
# Ship task page

- Status: Open (Active)
- Parent: [Parent task](/task/parent-task)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: July 12th, 2025

## Notes

Read rollout notes.

### Context

Ship behind a flag.`);
});

test("reads task page with hidden optional fields", async () => {
    const taskId = generateId<TaskId>();

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: taskId,
        title: "Bare task",
        status: {type: "Closed"},
    });

    mockGetTask(api, spaceId, taskId, {
        title: "Bare task",
        status: {type: "Closed"},
        collections: [],
        notes: {version: 0, content: addKeysToApiContentForTest(emptyNotesContent)},
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/task/bare-task",
            limit: "10kb",
        }),
    ).toEqual(`\
# Bare task

- Status: Closed`);
});
