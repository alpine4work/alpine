import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});

const {span} = testTracer.startSpan("call_agent_web_read_tool_messaging.test.ts");
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
        botId: generateId<BotId>(),
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await createAgentWebPageLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const chatPathname = await createAgentWebPageLinkPathname(storage, {
        type: "Chat",
        id: chatId,
        title: "Incident Response",
    });
    assert(chatPathname === "/chat/incident-response");
});

function createMessage(
    index: number,
    content: ApiContentResponse | string,
    {
        author = index % 2 === 0 ? aliceAccount : bobAccount,
        createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
        createdTimeZone = defaultTimeZone,
        parent,
    }: {
        author?: ApiAccount;
        createdTime?: string;
        createdTimeZone?: TimeZone;
        parent?: {
            author: ApiAccount;
            index: number;
            endIndex?: number;
            contentSnippet: ApiMessageContentPayloadParentContentSnippet | string;
        };
    } = {},
): ApiMessageResponse {
    return {
        index,
        author,
        createdTime: assertDateString(createdTime),
        createdTimeZone,
        payload: {
            type: "Content",
            content:
                typeof content === "string"
                    ? {elements: [{type: "Paragraph", elements: [{type: "Text", text: content}]}]}
                    : content,
            parent: parent
                ? {
                      type: "Message" as const,
                      index: parent.index,
                      ...(parent.endIndex !== undefined ? {endIndex: parent.endIndex} : {}),
                      author: parent.author,
                      contentSnippet:
                          typeof parent.contentSnippet === "string"
                              ? {
                                    elements: [{type: "Text", text: parent.contentSnippet}],
                                    isTruncated: false,
                                }
                              : parent.contentSnippet,
                  }
                : undefined,
        },
    };
}

function createMessages({
    startIndex,
    limit,
}: {
    startIndex: number;
    limit: number;
}): ReadonlyArray<ApiMessageResponse> {
    return createArrayWithLength(limit, index =>
        createMessage(startIndex + index, `Test message ${startIndex + index}`),
    );
}

function mockGetMessages({
    totalMessageCount,
    limit,
    cursor,
}: {
    totalMessageCount: number;
    limit: number;
    cursor?: number;
}) {
    const startIndex = Math.max((cursor ?? totalMessageCount) - limit, 0);

    api.mockGet(
        "/chats/{id}/messages",
        {
            data: {
                spaceId,
                totalMessageCount,
                nextCursor: startIndex !== 0 ? startIndex : null,
                messages: createMessages({startIndex, limit: Math.min(limit, totalMessageCount)}),
            },
        },
        {
            path: {id: chatId},
            query: {from: "End", limit, cursor},
        },
    );
}

function mockGetChat() {
    api.mockGet("/chats/{id}", {
        data: {
            spaceId,
            chat: {
                type: "Room",
                id: chatId,
                name: "Incident Response",
            },
        },
    });
}

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=87)

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

End of messages.`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=84)

<time>May 14th at 6:00pm EDT</time>

<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
    },
    {
        limit: "3.06kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=60)

<time>May 14th at 4:00pm EDT</time>

<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
    },
])("reads messages from end with one request (limit: $limit)", async ({limit, response}) => {
    mockGetChat();

    mockGetMessages({
        totalMessageCount: 90,
        limit: 30,
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit,
        }),
    ).toEqual(response);
});

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=17)

<time>May 14th at 12:20pm EDT</time>

<message id="16" from="[Alice](/human/alice)">

Test message 16

</message>

<message id="17" from="[Bob](/human/bob)" time="5 minutes later">

Test message 17

</message>

<message id="18" from="[Alice](/human/alice)" time="5 minutes later">

Test message 18

</message>

<message id="19" from="[Bob](/human/bob)" time="5 minutes later">

Test message 19

</message>

End of messages.`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=14)

<time>May 14th at 12:10pm EDT</time>

<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>

End of messages.`,
    },
    {
        limit: "3.06kb",
        response: `\
Some messages in Incident Response.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>

End of messages.`,
    },
])(
    "reads messages in small room from end with one request (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetMessages({
            totalMessageCount: 20,
            limit: 30,
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response",
                limit,
            }),
        ).toEqual(response);
    },
);
