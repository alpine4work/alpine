import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetTaskMessages} from "~/server/agents/api/test_helpers/mock_api_get_task_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {ApiTaskReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

const spaceId = generateId<SpaceId>();
const taskId = generateId<TaskId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const author = [aliceAccount, bobAccount];

const taskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: taskId,
    title: "Write Spec",
    status: {type: "Open", isActive: true},
};

const taskPath = "/task/write-spec";
const taskCommentsPath = "/task/write-spec/comments";

const {span} = testTracer.startSpan("call_agent_web_read_tool_task_message_list.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: generateId<AccountId>(),
        bot: {id: generateId<BotId>()},
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: context.botAccount.id,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: context.botAccount.bot,
    });
    assert(actualBotAccountPathname === "/bot/chatgpt");

    const actualTaskPathname = await storeAgentWebPageLinkForTest(storage, taskReference);
    assert(actualTaskPathname === taskPath);
});

function mockApiGetTaskReference() {
    api.mockGet("/tasks/{id}-reference", {
        params: {path: {id: taskId}},
        data: {spaceId, reference: taskReference},
    });
}

test("reads a task message list with one human comment", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: aliceAccount, content: "Looks good."}),
    });

    expect(await callAgentWebReadTool(context, {path: taskCommentsPath, limit: "10kb"})).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Looks good.

</comment>

End of comments.`);
});

test("adds next page link to task message list", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${taskCommentsPath}?start`,
            limit: "500b",
        }),
    ).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec). [Next page »](${taskCommentsPath}?after=2)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Test message 0

</comment>

<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</comment>

<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</comment>`);
});

test("adds previous page link to task message list", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        from: "End",
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${taskCommentsPath}?end`,
            limit: "500b",
        }),
    ).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec). [Previous page »](${taskCommentsPath}?before=17)

<time>May 14th at 12:25pm EDT</time>

<comment id="17" from="[Bob](/human/bob)">

Test message 17

</comment>

<comment id="18" from="[Alice](/human/alice)" time="5 minutes later">

Test message 18

</comment>

<comment id="19" from="[Bob](/human/bob)" time="5 minutes later">

Test message 19

</comment>

End of comments.`);
});

test("reads a task message list around a comment", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        totalMessageCount: 90,
        limit: 30,
        cursor: -11,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${taskCommentsPath}?comment=4`,
            limit: "500b",
        }),
    ).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec). [« Previous page](${taskCommentsPath}?before=3) | [Next page »](${taskCommentsPath}?after=5)

<time>May 14th at 11:15am EDT</time>\n
<comment id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</comment>\n
<comment id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</comment>`);
});

test("reads a task message list page before a comment", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        from: "End",
        totalMessageCount: 6,
        limit: 30,
        cursor: 3,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${taskCommentsPath}?before=3`,
            limit: "10kb",
        }),
    ).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Test message 0

</comment>

<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</comment>

<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</comment>`);
});

test("reads a task message list page after a comment", async () => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        totalMessageCount: 6,
        limit: 30,
        cursor: 2,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${taskCommentsPath}?after=2`,
            limit: "10kb",
        }),
    ).toEqual(`\
Comments on [Write Spec (Open, active)](/task/write-spec).

<time>May 14th at 11:15am EDT</time>

<comment id="3" from="[Bob](/human/bob)">

Test message 3

</comment>

<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">

Test message 4

</comment>

<comment id="5" from="[Bob](/human/bob)" time="5 minutes later">

Test message 5

</comment>

End of comments.`);
});

test.each([
    {from: "start", apiFrom: undefined},
    {from: "end", apiFrom: "End" as const},
])("reads task comments between before and after cursors from $from", async options => {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        from: options.apiFrom,
        cursor: options.from === "start" ? 39 : 45,
        totalMessageCount: 90,
        limit: 5,
        createMessage: index => createApiMessageMock({index, author}),
    });

    const response = await callAgentWebReadTool(context, {
        path: `${taskCommentsPath}?after=39&before=45&from=${options.from}`,
        limit: "20kb",
    });

    expect({
        commentIndexes: Array.from(response.matchAll(/<comment id="(-?[0-9]+)"/g), match =>
            Number(match[1]),
        ),
        hasPagination: response.includes("Previous page") || response.includes("Next page"),
        isEndOfComments: response.endsWith("End of comments."),
    }).toEqual({
        commentIndexes: [40, 41, 42, 43, 44],
        hasPagination: false,
        isEndOfComments: false,
    });
});
