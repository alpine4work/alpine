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
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
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

function mockGetChatMessages({
    from,
    totalMessageCount,
    limit,
    cursor,
    createMessage: actuallyCreateMessage = (index, startIndex) =>
        createMessage(startIndex + index, `Test message ${startIndex + index}`),
}: {
    from?: "Start" | "End";
    totalMessageCount: number;
    limit: number;
    cursor?: number;
    createMessage?: (index: number, startIndex: number) => ApiMessageResponse;
}) {
    switch (from) {
        case undefined:
        case "Start": {
            let startIndex = (cursor ?? -1) + 1;
            let endIndex = startIndex + limit - 1;

            startIndex = Math.max(startIndex, 0);
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            api.mockGet(
                "/chats/{id}/messages",
                {
                    data: {
                        spaceId,
                        totalMessageCount,
                        nextCursor: endIndex !== totalMessageCount - 1 ? endIndex : null,
                        messages: createArrayWithLength(
                            Math.max(endIndex - startIndex + 1, 0),
                            index => actuallyCreateMessage(index, startIndex),
                        ),
                    },
                },
                {
                    path: {id: chatId},
                    query: {from, limit, cursor},
                },
            );
            break;
        }
        case "End": {
            let endIndex = (cursor ?? totalMessageCount) - 1;
            let startIndex = endIndex - limit + 1;

            startIndex = Math.max(startIndex, 0);
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            api.mockGet(
                "/chats/{id}/messages",
                {
                    data: {
                        spaceId,
                        totalMessageCount,
                        nextCursor: startIndex !== 0 ? startIndex : null,
                        messages: createArrayWithLength(
                            Math.max(endIndex - startIndex + 1, 0),
                            index => actuallyCreateMessage(index, startIndex),
                        ),
                    },
                },
                {
                    path: {id: chatId},
                    query: {from, limit, cursor},
                },
            );
            break;
        }
        default:
            throw exhaustive(from);
    }
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
        limit: "3.05kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=61)

<time>May 14th at 4:05pm EDT</time>

<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
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

    mockGetChatMessages({
        from: "End",
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
Some messages in Incident Response. [Next page »](/chat/incident-response?after=3)

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

</message>`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`,
    },
    {
        limit: "3kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=28)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>`,
    },
    {
        limit: "3.018kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=29)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>`,
    },
])("reads messages from start with one request (limit: $limit)", async ({limit, response}) => {
    mockGetChat();

    mockGetChatMessages({
        totalMessageCount: 90,
        limit: 30,
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response?start",
            limit,
        }),
    ).toEqual(response);
});

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=17)

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

        mockGetChatMessages({
            from: "End",
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

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=3)

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

</message>`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`,
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
    "reads messages in small room from start with one request (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            totalMessageCount: 20,
            limit: 30,
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?start",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        limit: "2.89kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=1)

<time>May 14th at 11:05am EDT</time>

<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
    },
    {
        limit: "2.90kb",
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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
    },
])(
    "page ends right near the limit boundary when reading from end (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            from: "End",
            totalMessageCount: 29,
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

test.each([
    {
        limit: "2.89kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=27)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>`,
    },
    {
        limit: "2.90kb",
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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
    },
])(
    "page ends right near the limit boundary when reading from start (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            totalMessageCount: 29,
            limit: 30,
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?start",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 2,
        limit: "5kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=41)

<time>May 14th at 2:25pm EDT</time>

<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
    {
        requestCount: 2,
        limit: "6kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=30)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
    {
        requestCount: 3,
        limit: "7kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=21)

<time>May 14th at 12:45pm EDT</time>

<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
    {
        requestCount: 3,
        limit: "10kb",
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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
])(
    "reads messages from end with multiple requests (requests: $requestCount)",
    async ({requestCount, limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            from: "End",
            totalMessageCount: 90,
            limit: 30,
        });

        if (requestCount >= 2) {
            mockGetChatMessages({
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                cursor: 60,
            });
        }

        if (requestCount >= 3) {
            mockGetChatMessages({
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                cursor: 30,
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 2,
        limit: "5kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=49)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>`,
    },
    {
        requestCount: 2,
        limit: "5.958kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=59)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 3,
        limit: "7.5kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=74)

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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>`,
    },
    {
        requestCount: 3,
        limit: "10kb",
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
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
])(
    "reads messages from start with multiple requests (requests: $requestCount)",
    async ({requestCount, limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            totalMessageCount: 90,
            limit: 30,
        });

        if (requestCount >= 2) {
            mockGetChatMessages({
                totalMessageCount: 90,
                limit: 30,
                cursor: 29,
            });
        }

        if (requestCount >= 3) {
            mockGetChatMessages({
                totalMessageCount: 90,
                limit: 30,
                cursor: 59,
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?start",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=57)

<time>May 14th at 3:45pm EDT</time>

<message id="57" from="[Bob](/human/bob)">

Test message 57

</message>

<message id="58" from="[Alice](/human/alice)" time="5 minutes later">

Test message 58

</message>

<message id="59" from="[Bob](/human/bob)" time="5 minutes later">

Test message 59

</message>`,
    },
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "750b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=54)

<time>May 14th at 3:30pm EDT</time>

<message id="54" from="[Alice](/human/alice)">

Test message 54

</message>

<message id="55" from="[Bob](/human/bob)" time="5 minutes later">

Test message 55

</message>

<message id="56" from="[Alice](/human/alice)" time="5 minutes later">

Test message 56

</message>

<message id="57" from="[Bob](/human/bob)" time="5 minutes later">

Test message 57

</message>

<message id="58" from="[Alice](/human/alice)" time="5 minutes later">

Test message 58

</message>

<message id="59" from="[Bob](/human/bob)" time="5 minutes later">

Test message 59

</message>`,
    },
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "3.042kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=30)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 2,
        before: 60,
        cursors: [60, 30],
        limit: "4kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=21)

<time>May 14th at 12:45pm EDT</time>

<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
    },
])(
    "reads messages before a cursor with pagination (requests: $requestCount, limit: $limit)",
    async ({before, cursors, limit, response}) => {
        mockGetChat();

        for (const cursor of cursors) {
            mockGetChatMessages({
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                cursor,
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?before=" + before,
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "500b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=33)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">

Test message 30

</message>

<message id="31" from="[Bob](/human/bob)" time="5 minutes later">

Test message 31

</message>

<message id="32" from="[Alice](/human/alice)" time="5 minutes later">

Test message 32

</message>

<message id="33" from="[Bob](/human/bob)" time="5 minutes later">

Test message 33

</message>`,
    },
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "750b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=35)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">

Test message 30

</message>

<message id="31" from="[Bob](/human/bob)" time="5 minutes later">

Test message 31

</message>

<message id="32" from="[Alice](/human/alice)" time="5 minutes later">

Test message 32

</message>

<message id="33" from="[Bob](/human/bob)" time="5 minutes later">

Test message 33

</message>

<message id="34" from="[Alice](/human/alice)" time="5 minutes later">

Test message 34

</message>

<message id="35" from="[Bob](/human/bob)" time="5 minutes later">

Test message 35

</message>`,
    },
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "3.037kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=59)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 2,
        after: 29,
        cursors: [29, 59],
        limit: "5kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=78)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
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
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>`,
    },
])(
    "reads messages after a cursor with pagination (requests: $requestCount, limit: $limit)",
    async ({after, cursors, limit, response}) => {
        mockGetChat();

        for (const cursor of cursors) {
            mockGetChatMessages({
                totalMessageCount: 90,
                limit: 30,
                cursor,
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?after=" + after,
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=87)

<time>May 18th at 2:00am EDT</time>

<message id="87" from="[Bob](/human/bob)">

Test message 87

</message>

<time>May 18th at 3:00am EDT</time>

<message id="88" from="[Alice](/human/alice)">

Test message 88

</message>

<time>May 18th at 4:00am EDT</time>

<message id="89" from="[Bob](/human/bob)">

Test message 89

</message>

End of messages.`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=85)

<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
    },
    {
        limit: "3.47kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=61)

<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
    },
    {
        limit: "3.474kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=60)

<time>May 16th at 11:00pm EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
    },
])(
    "reads messages from end with one request when messages are more than an hour apart (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            from: "End",
            totalMessageCount: 90,
            limit: 30,
            createMessage: (index, startIndex) =>
                createMessage(startIndex + index, `Test message ${startIndex + index}`, {
                    createdTime: new Date(
                        Date.UTC(2026, 4, 14, 15, (startIndex + index) * 60),
                    ).toISOString(),
                }),
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        limit: "500b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=2)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<time>May 14th at 12:00pm EDT</time>

<message id="1" from="[Bob](/human/bob)">

Test message 1

</message>

<time>May 14th at 1:00pm EDT</time>

<message id="2" from="[Alice](/human/alice)">

Test message 2

</message>`,
    },
    {
        limit: "750b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>`,
    },
    {
        limit: "3.42kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>`,
    },
    {
        limit: "3.431kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=29)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>`,
    },
])(
    "reads messages from start with one request when messages are more than an hour apart (limit: $limit)",
    async ({limit, response}) => {
        mockGetChat();

        mockGetChatMessages({
            totalMessageCount: 90,
            limit: 30,
            createMessage: (index, startIndex) =>
                createMessage(startIndex + index, `Test message ${startIndex + index}`, {
                    createdTime: new Date(
                        Date.UTC(2026, 4, 14, 15, (startIndex + index) * 60),
                    ).toISOString(),
                }),
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?start",
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "500b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=57)

<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "750b",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=55)

<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 1,
        before: 60,
        cursors: [60],
        limit: "3.455kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=30)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 2,
        before: 60,
        cursors: [60, 30],
        limit: "4kb",
        response: `\
Some messages in Incident Response. [Previous page »](/chat/incident-response?before=26)

<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
    },
])(
    "reads messages before a cursor with pagination when messages are more than an hour apart (requests: $requestCount, limit: $limit)",
    async ({before, cursors, limit, response}) => {
        mockGetChat();

        for (const cursor of cursors) {
            mockGetChatMessages({
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                cursor,
                createMessage: (index, startIndex) =>
                    createMessage(startIndex + index, `Test message ${startIndex + index}`, {
                        createdTime: new Date(
                            Date.UTC(2026, 4, 14, 15, (startIndex + index) * 60),
                        ).toISOString(),
                    }),
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?before=" + before,
                limit,
            }),
        ).toEqual(response);
    },
);

test.each([
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "500b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=32)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>`,
    },
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "750b",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=34)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>`,
    },
    {
        requestCount: 1,
        after: 29,
        cursors: [29],
        limit: "3.45kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=59)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
    },
    {
        requestCount: 2,
        after: 29,
        cursors: [29, 59],
        limit: "5kb",
        response: `\
Some messages in Incident Response. [Next page »](/chat/incident-response?after=72)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>\n
<time>May 16th at 11:00pm EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>`,
    },
])(
    "reads messages after a cursor with pagination when messages are more than an hour apart (requests: $requestCount, limit: $limit)",
    async ({after, cursors, limit, response}) => {
        mockGetChat();

        for (const cursor of cursors) {
            mockGetChatMessages({
                totalMessageCount: 90,
                limit: 30,
                cursor,
                createMessage: (index, startIndex) =>
                    createMessage(startIndex + index, `Test message ${startIndex + index}`, {
                        createdTime: new Date(
                            Date.UTC(2026, 4, 14, 15, (startIndex + index) * 60),
                        ).toISOString(),
                    }),
            });
        }

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?after=" + after,
                limit,
            }),
        ).toEqual(response);
    },
);
