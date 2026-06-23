import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebChannelPageApiPostsBatchCount} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const channelId = generateId<ChannelId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const author = [aliceAccount, bobAccount];

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_channel.test.ts");
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
    await storage.deleteAll();
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Channel",
        id: channelId,
        title: "Announcements",
    });
});

function contentFromText(text: string): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Channel", version: 0}).encode({
                    pos: 0,
                    nodeSize: text.length,
                }),
                elements: [{type: "Text", text}],
            },
        ],
    };
}

function mockGetChannel({
    description = contentFromText("Updates from the team."),
}: {
    description?: ApiContentResponse;
} = {}) {
    api.mockGet(
        "/channels/{id}",
        {
            data: {
                spaceId,
                channel: {
                    id: channelId,
                    name: "Announcements",
                    description,
                },
            },
        },
        {path: {id: channelId}},
    );
}

function mockGetChannelPosts({
    cursor,
    totalPostCount,
    createdTimes,
}: {
    cursor?: string;
    totalPostCount?: number;
    createdTimes?: ReadonlyArray<DateString>;
}) {
    let postCreatedTimes: ReadonlyArray<DateString>;

    if (createdTimes !== undefined) {
        postCreatedTimes = createdTimes;
    } else {
        assert(totalPostCount !== undefined);
        postCreatedTimes = Array.from({length: totalPostCount}, (_, index) =>
            getChannelPostCreatedTime(index),
        );
    }
    const postCount = postCreatedTimes.length;
    let startIndex = 0;

    if (cursor !== undefined) {
        const cursorTime = new Date(cursor).getTime();
        const cursorIndex = postCreatedTimes.findIndex(
            createdTime => new Date(createdTime).getTime() > cursorTime,
        );

        startIndex = cursorIndex === -1 ? postCount : cursorIndex;
    }

    const endIndex = Math.min(
        startIndex + agentWebChannelPageApiPostsBatchCount - 1,
        postCount - 1,
    );
    const returnedPostCount = Math.max(endIndex - startIndex + 1, 0);

    api.mockGet(
        "/channels/{id}/posts",
        {
            data: {
                spaceId,
                channel: {
                    id: channelId,
                    name: "Announcements",
                },
                nextCursor: endIndex < postCount - 1 ? postCreatedTimes[endIndex]! : null,
                posts: Array.from({length: returnedPostCount}, (_, index) => {
                    const postIndex = startIndex + index;

                    return {
                        id: generateId<PostId>(),
                        author: author[postIndex % author.length]!,
                        createdTime: postCreatedTimes[postIndex]!,
                        createdTimeZone: defaultTimeZone,
                        channel: {id: channelId, name: "Announcements"},
                        contentSnippet: contentFromText(getChannelPostTitle(postIndex)),
                        reference: {title: getChannelPostTitle(postIndex)},
                    };
                }),
            },
        },
        {
            path: {id: channelId},
            query: {
                limit: agentWebChannelPageApiPostsBatchCount,
                cursor,
            },
        },
    );
}

function getChannelPostCreatedTime(index: number): DateString {
    return serializeDateString(new Date(Date.UTC(2026, 4, 14, 15, index * 5)));
}

function dateString(string: string): DateString {
    return serializeDateString(new Date(string));
}

function getChannelPostTitle(index: number): string {
    return `Test post content ${index + 1}`;
}

test("reads the first channel page with posts", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        totalPostCount: 2,
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "10kb"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

End of posts.`);
});

test("reads later channel posts after a cursor", async () => {
    mockGetChannelPosts({
        cursor: "2026-05-14T16:05:59.999Z",
        totalPostCount: 16,
    });

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements?after=2026-05-14T16:05",
        limit: "10kb",
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: "2026-05-14T16:05:59.999Z",
                },
            },
        ],
        response: `\
Posts in Announcements.

<post from="[Alice](/human/alice)" time="May 14th at 12:10pm EDT">

Test post content 15

[See more »](/post/test-post-content-15)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 12:15pm EDT">

Test post content 16

[See more »](/post/test-post-content-16)

</post>

End of posts.`,
    });
});

test("reads later channel posts after a date-only cursor", async () => {
    mockGetChannelPosts({
        cursor: "2026-05-14T23:59:59.999Z",
        createdTimes: [
            dateString("2026-05-14T15:00:00.000Z"),
            dateString("2026-05-15T15:00:00.000Z"),
        ],
    });

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements?after=2026-05-14",
        limit: "10kb",
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: "2026-05-14T23:59:59.999Z",
                },
            },
        ],
        response: `\
Posts in Announcements.

<post from="[Bob](/human/bob)" time="May 15th at 11:00am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

End of posts.`,
    });
});

test("reads later channel posts after a seconds cursor", async () => {
    mockGetChannelPosts({
        cursor: "2026-05-14T15:15:10.999Z",
        createdTimes: [
            dateString("2026-05-14T15:15:10.000Z"),
            dateString("2026-05-14T15:15:11.000Z"),
        ],
    });

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements?after=2026-05-14T15:15:10",
        limit: "10kb",
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: "2026-05-14T15:15:10.999Z",
                },
            },
        ],
        response: `\
Posts in Announcements.

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

End of posts.`,
    });
});

test("reads later channel posts after a milliseconds cursor", async () => {
    mockGetChannelPosts({
        cursor: "2026-05-14T15:15:10.123Z",
        createdTimes: [
            dateString("2026-05-14T15:15:10.123Z"),
            dateString("2026-05-14T15:15:10.456Z"),
        ],
    });

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements?after=2026-05-14T15:15:10.123",
        limit: "10kb",
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: "2026-05-14T15:15:10.123Z",
                },
            },
        ],
        response: `\
Posts in Announcements.

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

End of posts.`,
    });
});

test("loads more post pages while the response is still under the limit", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        totalPostCount: 40,
    });
    mockGetChannelPosts({
        cursor: getChannelPostCreatedTime(14),
        totalPostCount: 40,
    });
    mockGetChannelPosts({
        cursor: getChannelPostCreatedTime(29),
        totalPostCount: 40,
    });

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements",
        limit: "10kb",
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: undefined,
                },
            },
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: getChannelPostCreatedTime(14),
                },
            },
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: getChannelPostCreatedTime(29),
                },
            },
        ],
        response: `\
# Announcements

Updates from the team.

---

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">\n\nTest post content 1\n\n[See more »](/post/test-post-content-1)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">\n\nTest post content 2\n\n[See more »](/post/test-post-content-2)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">\n\nTest post content 3\n\n[See more »](/post/test-post-content-3)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">\n\nTest post content 4\n\n[See more »](/post/test-post-content-4)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:20am EDT">\n\nTest post content 5\n\n[See more »](/post/test-post-content-5)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:25am EDT">\n\nTest post content 6\n\n[See more »](/post/test-post-content-6)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:30am EDT">\n\nTest post content 7\n\n[See more »](/post/test-post-content-7)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:35am EDT">\n\nTest post content 8\n\n[See more »](/post/test-post-content-8)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:40am EDT">\n\nTest post content 9\n\n[See more »](/post/test-post-content-9)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:45am EDT">\n\nTest post content 10\n\n[See more »](/post/test-post-content-10)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:50am EDT">\n\nTest post content 11\n\n[See more »](/post/test-post-content-11)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:55am EDT">\n\nTest post content 12\n\n[See more »](/post/test-post-content-12)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:00pm EDT">\n\nTest post content 13\n\n[See more »](/post/test-post-content-13)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:05pm EDT">\n\nTest post content 14\n\n[See more »](/post/test-post-content-14)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:10pm EDT">\n\nTest post content 15\n\n[See more »](/post/test-post-content-15)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:15pm EDT">\n\nTest post content 16\n\n[See more »](/post/test-post-content-16)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:20pm EDT">\n\nTest post content 17\n\n[See more »](/post/test-post-content-17)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:25pm EDT">\n\nTest post content 18\n\n[See more »](/post/test-post-content-18)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:30pm EDT">\n\nTest post content 19\n\n[See more »](/post/test-post-content-19)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:35pm EDT">\n\nTest post content 20\n\n[See more »](/post/test-post-content-20)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:40pm EDT">\n\nTest post content 21\n\n[See more »](/post/test-post-content-21)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:45pm EDT">\n\nTest post content 22\n\n[See more »](/post/test-post-content-22)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:50pm EDT">\n\nTest post content 23\n\n[See more »](/post/test-post-content-23)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:55pm EDT">\n\nTest post content 24\n\n[See more »](/post/test-post-content-24)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:00pm EDT">\n\nTest post content 25\n\n[See more »](/post/test-post-content-25)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:05pm EDT">\n\nTest post content 26\n\n[See more »](/post/test-post-content-26)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:10pm EDT">\n\nTest post content 27\n\n[See more »](/post/test-post-content-27)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:15pm EDT">\n\nTest post content 28\n\n[See more »](/post/test-post-content-28)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:20pm EDT">\n\nTest post content 29\n\n[See more »](/post/test-post-content-29)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:25pm EDT">\n\nTest post content 30\n\n[See more »](/post/test-post-content-30)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:30pm EDT">\n\nTest post content 31\n\n[See more »](/post/test-post-content-31)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:35pm EDT">\n\nTest post content 32\n\n[See more »](/post/test-post-content-32)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:40pm EDT">\n\nTest post content 33\n\n[See more »](/post/test-post-content-33)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:45pm EDT">\n\nTest post content 34\n\n[See more »](/post/test-post-content-34)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 1:50pm EDT">\n\nTest post content 35\n\n[See more »](/post/test-post-content-35)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 1:55pm EDT">\n\nTest post content 36\n\n[See more »](/post/test-post-content-36)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 2:00pm EDT">\n\nTest post content 37\n\n[See more »](/post/test-post-content-37)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 2:05pm EDT">\n\nTest post content 38\n\n[See more »](/post/test-post-content-38)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 2:10pm EDT">\n\nTest post content 39\n\n[See more »](/post/test-post-content-39)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 2:15pm EDT">\n\nTest post content 40\n\n[See more »](/post/test-post-content-40)\n\n</post>\n
End of posts.`,
    });
});

test("does not load more or truncate when the response is exactly at the limit", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        totalPostCount: 16,
    });

    const expectedResponse = `\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T16:05)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">\n\nTest post content 1\n\n[See more »](/post/test-post-content-1)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">\n\nTest post content 2\n\n[See more »](/post/test-post-content-2)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">\n\nTest post content 3\n\n[See more »](/post/test-post-content-3)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">\n\nTest post content 4\n\n[See more »](/post/test-post-content-4)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:20am EDT">\n\nTest post content 5\n\n[See more »](/post/test-post-content-5)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:25am EDT">\n\nTest post content 6\n\n[See more »](/post/test-post-content-6)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:30am EDT">\n\nTest post content 7\n\n[See more »](/post/test-post-content-7)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:35am EDT">\n\nTest post content 8\n\n[See more »](/post/test-post-content-8)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:40am EDT">\n\nTest post content 9\n\n[See more »](/post/test-post-content-9)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:45am EDT">\n\nTest post content 10\n\n[See more »](/post/test-post-content-10)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 11:50am EDT">\n\nTest post content 11\n\n[See more »](/post/test-post-content-11)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 11:55am EDT">\n\nTest post content 12\n\n[See more »](/post/test-post-content-12)\n\n</post>\n
<post from="[Alice](/human/alice)" time="May 14th at 12:00pm EDT">\n\nTest post content 13\n\n[See more »](/post/test-post-content-13)\n\n</post>\n
<post from="[Bob](/human/bob)" time="May 14th at 12:05pm EDT">\n\nTest post content 14\n\n[See more »](/post/test-post-content-14)\n\n</post>`;

    const response = await callAgentWebReadTool(context, {
        path: "/channel/announcements",
        limit: `${expectedResponse.length}b`,
    });
    const postRequestParams = api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/channels/{id}/posts")
        .map(request => request.params);

    expect({response, postRequestParams}).toEqual({
        response: expectedResponse,
        postRequestParams: [
            {
                path: {id: channelId},
                query: {
                    limit: agentWebChannelPageApiPostsBatchCount,
                    cursor: undefined,
                },
            },
        ],
    });
});

test("reads a channel page with an empty description", async () => {
    mockGetChannel({description: {elements: []}});
    mockGetChannelPosts({
        totalPostCount: 0,
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "10kb"}))
        .toEqual(`\
# Announcements

---

End of posts.`);
});

test("truncates channel posts and updates the next page cursor", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        totalPostCount: 6,
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "720b"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:15)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">

Test post content 3

[See more »](/post/test-post-content-3)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 4

[See more »](/post/test-post-content-4)

</post>`);
});

test("truncates channel posts with a date-only next page cursor", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        createdTimes: [
            dateString("2026-05-14T15:00:00.000Z"),
            dateString("2026-05-14T15:05:00.000Z"),
            dateString("2026-05-14T15:10:00.000Z"),
            dateString("2026-05-14T15:15:00.000Z"),
            dateString("2026-05-15T15:20:00.000Z"),
            dateString("2026-05-15T15:25:00.000Z"),
        ],
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "720b"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">

Test post content 3

[See more »](/post/test-post-content-3)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 4

[See more »](/post/test-post-content-4)

</post>`);
});

test("truncates channel posts with a seconds next page cursor", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        createdTimes: [
            dateString("2026-05-14T15:00:00.000Z"),
            dateString("2026-05-14T15:05:00.000Z"),
            dateString("2026-05-14T15:10:00.000Z"),
            dateString("2026-05-14T15:15:10.000Z"),
            dateString("2026-05-14T15:15:20.000Z"),
            dateString("2026-05-14T15:20:00.000Z"),
        ],
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "720b"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:15:10)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">

Test post content 3

[See more »](/post/test-post-content-3)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 4

[See more »](/post/test-post-content-4)

</post>`);
});

test("truncates channel posts with a milliseconds next page cursor", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        createdTimes: [
            dateString("2026-05-14T15:00:00.000Z"),
            dateString("2026-05-14T15:05:00.000Z"),
            dateString("2026-05-14T15:10:00.000Z"),
            dateString("2026-05-14T15:15:10.123Z"),
            dateString("2026-05-14T15:15:10.456Z"),
            dateString("2026-05-14T15:20:00.000Z"),
        ],
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "720b"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:15:10.123)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">

Test post content 3

[See more »](/post/test-post-content-3)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 4

[See more »](/post/test-post-content-4)

</post>`);
});

test("truncates channel posts with an existing next page cursor", async () => {
    mockGetChannel();
    mockGetChannelPosts({
        totalPostCount: 16,
    });

    expect(await callAgentWebReadTool(context, {path: "/channel/announcements", limit: "720b"}))
        .toEqual(`\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:15)

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT">

Test post content 1

[See more »](/post/test-post-content-1)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:05am EDT">

Test post content 2

[See more »](/post/test-post-content-2)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT">

Test post content 3

[See more »](/post/test-post-content-3)

</post>

<post from="[Bob](/human/bob)" time="May 14th at 11:15am EDT">

Test post content 4

[See more »](/post/test-post-content-4)

</post>`);
});

test("throws on invalid channel search parameters", async () => {
    const cases = [
        {
            query: "before=2026-05-14T15%3A05%3A00.000Z",
            error: "Unsupported channel page search param",
        },
        {
            query: "after=not-a-cursor",
            error: "Expected `after` search param to be a cursor",
        },
    ] as const;

    for (const {query, error} of cases) {
        await expect(
            callAgentWebReadTool(context, {
                path: `/channel/announcements?${query}`,
                limit: "10kb",
            }),
        ).rejects.toThrow(error);
    }
});
