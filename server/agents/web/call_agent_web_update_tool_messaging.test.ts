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

const {span} = testTracer.startSpan("call_agent_web_update_tool_messaging.test.ts");
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
    const startIndex = (cursor ?? totalMessageCount) - limit;

    api.mockGet(
        "/chats/{id}/messages",
        {
            data: {
                spaceId,
                totalMessageCount,
                nextCursor: startIndex,
                messages: createMessages({startIndex, limit}),
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

test("creates a new message with update tool call", async () => {
    mockGetChat();

    mockGetMessages({
        totalMessageCount: 90,
        limit: 30,
    });

    console.log(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "500b",
        }),
    );
});
