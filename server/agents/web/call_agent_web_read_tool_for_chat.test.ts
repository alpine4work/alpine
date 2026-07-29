import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetChatMessages} from "~/server/agents/api/test_helpers/mock_api_get_chat_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const author = [aliceAccount, bobAccount];

const {span} = testTracer.startSpan("call_agent_web_read_tool_chat.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: generateId<AccountId>(),
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: generateId<BotId>()},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const chatPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Chat",
        id: chatId,
        title: "Incident Response",
    });
    assert(chatPathname === "/chat/incident-response");
});

async function mockDirectChatForTest(): Promise<{chatId: ChatId; path: string}> {
    const directChatId = generateId<ChatId>();
    const path = await storeAgentWebPageLinkForTest(storage, {
        type: "Chat",
        id: directChatId,
        title: "Alice and Bob",
    });

    api.mockGet("/chats/{id}", {
        params: {path: {id: directChatId}},
        data: {
            spaceId,
            chat: {
                type: "Direct",
                id: directChatId,
                members: [{account: aliceAccount}, {account: bobAccount}],
                reference: {title: "Alice and Bob"},
            },
        },
    });

    return {chatId: directChatId, path};
}

test("reads a direct chat with one human message", async () => {
    const directChatId = generateId<ChatId>();
    const path = await storeAgentWebPageLinkForTest(storage, {
        type: "Chat",
        id: directChatId,
        title: "Alice",
    });

    api.mockGet("/chats/{id}", {
        params: {path: {id: directChatId}},
        data: {
            spaceId,
            chat: {
                type: "Direct",
                id: directChatId,
                members: [{account: aliceAccount}, {account: bobAccount}],
                reference: {title: "Alice"},
            },
        },
    });
    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: aliceAccount, content: "Hello world!"}),
    });

    expect(await callAgentWebReadTool(context, {path, limit: "10kb"})).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Hello world!

</message>

End of messages.`);
});

test("adds next page link to direct chat when there are no pagination links", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${path}?start`,
            limit: "500b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [Next page »](${path}?after=2)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>`);
});

test("adds previous page link to direct chat when there are no pagination links", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        from: "End",
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path,
            limit: "500b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [Previous page »](${path}?before=17)

<time>May 14th at 12:25pm EDT</time>

<message id="17" from="[Bob](/human/bob)">

Test message 17

</message>

<message id="18" from="[Alice](/human/alice)" time="5 minutes later">

Test message 18

</message>

<message id="19" from="[Bob](/human/bob)" time="5 minutes later">

Test message 19

</message>

End of messages.`);
});

test("adds next page link to direct chat when there is already a pagination link", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        totalMessageCount: 90,
        limit: 30,
        cursor: 70,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${path}?message=85`,
            limit: "510b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [« Previous page](${path}?before=84) | [Next page »](${path}?after=86)

<time>May 14th at 6:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>`);
});

test("adds previous page link to direct chat when there is already a pagination link", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        totalMessageCount: 90,
        limit: 30,
        cursor: -11,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${path}?message=4`,
            limit: "500b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [« Previous page](${path}?before=3) | [Next page »](${path}?after=5)

<time>May 14th at 11:15am EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`);
});

test("updates next page pagination link for direct chat", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        totalMessageCount: 90,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: `${path}?start`,
            limit: "500b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [Next page »](${path}?after=3)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>`);
});

test("updates previous page pagination link for direct chat", async () => {
    const {chatId: directChatId, path} = await mockDirectChatForTest();

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        from: "End",
        totalMessageCount: 90,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path,
            limit: "500b",
        }),
    ).toEqual(`\
Chat with [Alice](/human/alice) and [Bob](/human/bob). [Previous page »](${path}?before=87)

<time>May 14th at 6:15pm EDT</time>

<message id="87" from="[Bob](/human/bob)">

Test message 87

</message>

<message id="88" from="[Alice](/human/alice)" time="5 minutes later">

Test message 88

</message>

<message id="89" from="[Bob](/human/bob)" time="5 minutes later">

Test message 89

</message>

End of messages.`);
});
