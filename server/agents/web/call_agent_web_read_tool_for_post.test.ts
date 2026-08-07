import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetPostMessages} from "~/server/agents/api/test_helpers/mock_api_get_post_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {
    TimeZone,
    assertTimeZone,
    defaultTimeZone,
} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChannelId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const postId = generateId<PostId>();
const channelId = generateId<ChannelId>();
const pacificTimeZone = assertTimeZone("America/Los_Angeles");

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const author = [aliceAccount, bobAccount];
const postReference: ApiPostReferenceResponse = {
    type: "Post",
    id: postId,
    title: "Launch",
};

const {span} = testTracer.startSpan("call_agent_web_read_tool_post.test.ts");
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

    await storeAgentWebPageLinkForTest(storage, [context.botAccount, postReference]);
});

function contentFromText(text: string): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    });
}

function mockGetPost({
    content,
    createdTime = new Date("2026-05-14T15:00:00.000Z"),
    createdTimeZone = defaultTimeZone,
    channelName = "Announcements",
    title = postReference.title,
}: {
    content?: ApiContentResponse;
    createdTime?: Date;
    createdTimeZone?: TimeZone;
    channelName?: string;
    title?: string;
} = {}) {
    api.mockGet("/posts/{id}", {
        params: {path: {id: postId}},
        data: {
            spaceId,
            post: {
                id: postId,
                author: aliceAccount,
                createdTime: serializeDateString(createdTime),
                createdTimeZone,
                channel: {id: channelId, name: channelName},
                content: content ?? contentFromText("Post body."),
                reference: {title},
            },
        },
    });
}

function mockGetPostReference() {
    api.mockGet("/posts/{id}-reference", {
        params: {path: {id: postId}},
        data: {
            spaceId,
            reference: {
                type: "Post",
                id: postId,
                title: postReference.title,
            },
        },
    });
}

test("reads the first post page with the post above comments", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: bobAccount, content: "First comment."}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch", limit: "10kb"})).toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Bob](/human/bob)">\n\nFirst comment.\n\n</comment>

End of comments.`);
});

test("reads later post comment pages without the post", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: 2,
        totalMessageCount: 5,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index === 3 ? bobAccount : aliceAccount,
                content: index === 3 ? "Third comment." : "Fourth comment.",
            }),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch?after=2",
        limit: "10kb",
    });

    expect(response).toEqual(`\
Comments on [post](/post/launch).

<time>May 14th at 11:15am EDT</time>

<comment id="3" from="[Bob](/human/bob)">\n\nThird comment.\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nFourth comment.\n\n</comment>

End of comments.`);
});

test("reads tail post comment pages after a comment", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: 8,
        totalMessageCount: 100,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index % 2 === 0 ? bobAccount : aliceAccount,
                content: `Tail comment ${index}.`,
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?after=8", limit: "750b"}))
        .toEqual(`\
Comments on [post](/post/launch). [Next page »](/post/launch?after=14)

<time>May 14th at 11:45am EDT</time>

<comment id="9" from="[Alice](/human/alice)">\n\nTail comment 9.\n\n</comment>\n
<comment id="10" from="[Bob](/human/bob)" time="5 minutes later">\n\nTail comment 10.\n\n</comment>\n
<comment id="11" from="[Alice](/human/alice)" time="5 minutes later">\n\nTail comment 11.\n\n</comment>\n
<comment id="12" from="[Bob](/human/bob)" time="5 minutes later">\n\nTail comment 12.\n\n</comment>\n
<comment id="13" from="[Alice](/human/alice)" time="5 minutes later">\n\nTail comment 13.\n\n</comment>\n
<comment id="14" from="[Bob](/human/bob)" time="5 minutes later">\n\nTail comment 14.\n\n</comment>`);
});

test("reads small tail post comment pages after a comment", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: 8,
        totalMessageCount: 11,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index % 2 === 0 ? bobAccount : aliceAccount,
                content: `Tail comment ${index}.`,
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?after=8", limit: "10kb"}))
        .toEqual(`\
Comments on [post](/post/launch).

<time>May 14th at 11:45am EDT</time>

<comment id="9" from="[Alice](/human/alice)">\n\nTail comment 9.\n\n</comment>\n
<comment id="10" from="[Bob](/human/bob)" time="5 minutes later">\n\nTail comment 10.\n\n</comment>

End of comments.`);
});

test("reads a post with no comments", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 0,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author: bobAccount}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch", limit: "10kb"})).toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>`);
});

test("reads a post with a timezone attribute when the post timezone differs", async () => {
    mockGetPost({createdTimeZone: pacificTimeZone});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 0,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author: bobAccount}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch", limit: "10kb"})).toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)" timezone="PDT">\n\nPost body.\n\n</post>`);
});

test("truncates comments while keeping the first-page post", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch",
        limit: "650b",
    });

    expect(response).toEqual(`\
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=3)

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</comment>`);
});

test("post was ten minutes before first comment", async () => {
    mockGetPost({
        createdTime: new Date("2026-05-14T14:50:00.000Z"),
    });

    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch",
        limit: "650b",
    });

    expect(response).toEqual(`\
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=3)

<time>May 14th at 10:50am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)" time="10 minutes later">\n\nTest message 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</comment>`);
});

test("post was three hours before first comment", async () => {
    mockGetPost({
        createdTime: new Date("2026-05-14T12:00:00.000Z"),
    });

    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 20,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch",
        limit: "650b",
    });

    expect(response).toEqual(`\
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=3)

<time>May 14th at 8:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</comment>`);
});

test("drops the post around a comment when the post does not fit", async () => {
    mockGetPost({content: contentFromText("Long post. ".repeat(300))});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: -15,
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: bobAccount, content: "Near the start."}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch?comment=0",
        limit: "900b",
    });

    expect(response).toEqual(`\
Comments on [post](/post/launch). [Previous page »](/post/launch?before=0)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Bob](/human/bob)">\n\nNear the start.\n\n</comment>

End of comments.`);
});

test("returns not found around a comment index before the first comment", async () => {
    mockGetPost({content: contentFromText("Long post. ".repeat(300))});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: -16,
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: bobAccount, content: "Near the start."}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/post/launch?comment=-1",
        limit: "900b",
    });

    expect(response).toEqual(
        "Error: Couldn\u2019t read `/post/launch?comment=-1`. Couldn\u2019t find any comments in the requested range `-1`. Try again with a `<comment>` `id` attribute you\u2019ve seen before.",
    );
});

test("paginates forward from the post and truncates comments", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 6,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?start", limit: "650b"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=3)

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 3\n\n</comment>`);
});

test("paginates forward from the post without truncating comments", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 6,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?start", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 3\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 4\n\n</comment>\n
<comment id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 5\n\n</comment>

End of comments.`);
});

test("paginates after the post with a custom cursor", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 2,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index === 0 ? bobAccount : aliceAccount,
                content: index === 0 ? "First comment." : "Second comment.",
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?after=post", limit: "750b"}))
        .toEqual(`\
Comments on [post](/post/launch).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Bob](/human/bob)">\n\nFirst comment.\n\n</comment>\n
<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nSecond comment.\n\n</comment>

End of comments.`);
});

test("paginates after the post with a custom cursor when there are many messages", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 100,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index % 2 === 0 ? bobAccount : aliceAccount,
                content: `Test comment ${index}.`,
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?after=post", limit: "750b"}))
        .toEqual(`\
Comments on [post](/post/launch). [Next page »](/post/launch?after=5)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Bob](/human/bob)">\n\nTest comment 0.\n\n</comment>\n
<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 1.\n\n</comment>\n
<comment id="2" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 2.\n\n</comment>\n
<comment id="3" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 3.\n\n</comment>\n
<comment id="4" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 4.\n\n</comment>\n
<comment id="5" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 5.\n\n</comment>`);
});

test("paginates before the post with a custom cursor", async () => {
    mockGetPostReference();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 0,
        totalMessageCount: 2,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=post", limit: "10kb"}))
        .toEqual(`\
Comments on [post](/post/launch).`);
});

test("reads a comment-only page before a later comment", async () => {
    mockGetPost({content: contentFromText("Long post. ".repeat(300))});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 20,
        totalMessageCount: 100,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: bobAccount,
                content: `Before comment ${index}.`,
                createdTime: new Date(Date.UTC(2026, 4, 14, 15, index)).toISOString(),
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=20", limit: "3kb"}))
        .toEqual(`\
Comments on [post](/post/launch). [Previous page »](/post/launch?before=0)

<time>May 14th at 11:00am EDT</time>

<comment id="0-19" from="[Bob](/human/bob)">\n\nBefore comment 0.\n\nBefore comment 1.\n\nBefore comment 2.\n\nBefore comment 3.\n\nBefore comment 4.\n\nBefore comment 5.\n\nBefore comment 6.\n\nBefore comment 7.\n\nBefore comment 8.\n\nBefore comment 9.\n\nBefore comment 10.\n\nBefore comment 11.\n\nBefore comment 12.\n\nBefore comment 13.\n\nBefore comment 14.\n\nBefore comment 15.\n\nBefore comment 16.\n\nBefore comment 17.\n\nBefore comment 18.\n\nBefore comment 19.\n\n</comment>`);
});

test("paginates backward near the post and truncates the post", async () => {
    mockGetPost({content: contentFromText("Long post. ".repeat(300))});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 2,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=2", limit: "650b"}))
        .toEqual(`\
Comments on [post](/post/launch). [Previous page »](/post/launch?before=0)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>`);
});

test("does not use scroll truncation around a comment after replacing a shorter post preamble", async () => {
    const title = "A long post title that makes the comments preamble longer";
    const longPostReference = {...postReference, title};

    await storage.deleteAll();
    await storeAgentWebPageLinkForTest(storage, context.botAccount);
    const pathname = await storeAgentWebPageLinkForTest(storage, longPostReference);

    mockGetPost({
        content: contentFromText("Long post. ".repeat(300)),
        channelName: "A",
        title,
    });
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: -14,
        totalMessageCount: 3,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    const response = await callAgentWebReadTool(context, {
        path: `${pathname}?comment=1`,
        limit: "420b",
    });

    expect(response).toEqual(`\
Comments on [post](/post/a-long-post-title-that-makes-the-comment). [« Previous page](/post/a-long-post-title-that-makes-the-comment?before=1) | [Next page »](/post/a-long-post-title-that-makes-the-comment?after=1)

<time>May 14th at 11:05am EDT</time>

<comment id="1" from="[Bob](/human/bob)">\n\nTest comment 1\n\n</comment>`);
});

test("does not use scroll truncation before a comment after replacing a shorter post preamble", async () => {
    const title = "A long post title that makes the comments preamble longer";
    const longPostReference = {...postReference, title};

    await storage.deleteAll();
    await storeAgentWebPageLinkForTest(storage, context.botAccount);
    const pathname = await storeAgentWebPageLinkForTest(storage, longPostReference);

    mockGetPost({
        content: contentFromText("Long post. ".repeat(300)),
        channelName: "A",
        title,
    });
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 2,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    const response = await callAgentWebReadTool(context, {
        path: `${pathname}?before=2`,
        limit: "345b",
    });

    expect(response).toEqual(`\
Comments on [post](/post/a-long-post-title-that-makes-the-comment). [Previous page »](/post/a-long-post-title-that-makes-the-comment?before=1)

<time>May 14th at 11:05am EDT</time>

<comment id="1" from="[Bob](/human/bob)">\n\nTest comment 1\n\n</comment>`);
});

test("paginates backward near the post without truncating the post", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 2,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=2", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>`);
});

test("paginates backward with a second comment load and reaches the post", async () => {
    mockGetPostReference();
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 31,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 1,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=31", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 3\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 4\n\n</comment>\n
<comment id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 5\n\n</comment>\n
<comment id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 6\n\n</comment>\n
<comment id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 7\n\n</comment>\n
<comment id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 8\n\n</comment>\n
<comment id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 9\n\n</comment>\n
<comment id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 10\n\n</comment>\n
<comment id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 11\n\n</comment>\n
<comment id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 12\n\n</comment>\n
<comment id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 13\n\n</comment>\n
<comment id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 14\n\n</comment>\n
<comment id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 15\n\n</comment>\n
<comment id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 16\n\n</comment>\n
<comment id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 17\n\n</comment>\n
<comment id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 18\n\n</comment>\n
<comment id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 19\n\n</comment>\n
<comment id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 20\n\n</comment>\n
<comment id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 21\n\n</comment>\n
<comment id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 22\n\n</comment>\n
<comment id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 23\n\n</comment>\n
<comment id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 24\n\n</comment>\n
<comment id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 25\n\n</comment>\n
<comment id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 26\n\n</comment>\n
<comment id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 27\n\n</comment>\n
<comment id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 28\n\n</comment>\n
<comment id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 29\n\n</comment>\n
<comment id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 30\n\n</comment>`);
});

test("paginates around the first comment and keeps the post when it fits", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: -15,
        totalMessageCount: 3,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?comment=0", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>

End of comments.`);
});

test("paginates around a comment and truncates the post before a following comment", async () => {
    mockGetPost({content: contentFromText("Long post. ".repeat(300))});
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: -14,
        totalMessageCount: 12,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?comment=1", limit: "3kb"}))
        .toEqual(`\
Comments on [post](/post/launch). [« Previous page](/post/launch?before=0) | [Next page »](/post/launch?after=2)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>`);
});

test("paginates around a comment with a second load and reaches the post", async () => {
    mockGetPostReference();
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        cursor: 5,
        totalMessageCount: 36,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 6,
        totalMessageCount: 36,
        limit: 15,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?comment=20", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 3\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 4\n\n</comment>\n
<comment id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 5\n\n</comment>\n
<comment id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 6\n\n</comment>\n
<comment id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 7\n\n</comment>\n
<comment id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 8\n\n</comment>\n
<comment id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 9\n\n</comment>\n
<comment id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 10\n\n</comment>\n
<comment id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 11\n\n</comment>\n
<comment id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 12\n\n</comment>\n
<comment id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 13\n\n</comment>\n
<comment id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 14\n\n</comment>\n
<comment id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 15\n\n</comment>\n
<comment id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 16\n\n</comment>\n
<comment id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 17\n\n</comment>\n
<comment id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 18\n\n</comment>\n
<comment id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 19\n\n</comment>\n
<comment id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 20\n\n</comment>\n
<comment id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 21\n\n</comment>\n
<comment id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 22\n\n</comment>\n
<comment id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 23\n\n</comment>\n
<comment id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 24\n\n</comment>\n
<comment id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 25\n\n</comment>\n
<comment id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 26\n\n</comment>\n
<comment id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 27\n\n</comment>\n
<comment id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 28\n\n</comment>\n
<comment id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 29\n\n</comment>\n
<comment id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 30\n\n</comment>\n
<comment id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 31\n\n</comment>\n
<comment id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 32\n\n</comment>\n
<comment id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 33\n\n</comment>\n
<comment id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 34\n\n</comment>\n
<comment id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 35\n\n</comment>

End of comments.`);
});

test("paginates backward before the first comment and only reads the post", async () => {
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 0,
        totalMessageCount: 60,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=0", limit: "10kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>`);
});

test("uses scroll truncation for a post larger than the limit and hides comments", async () => {
    mockGetPost({
        content: addKeysToApiContentForTest({
            elements: Array.from({length: 8}, (_, index) => ({
                type: "Paragraph" as const,
                elements: [
                    {
                        type: "Text" as const,
                        text:
                            `Long post paragraph ${index + 1} ` +
                            "detail detail detail detail detail detail detail detail.",
                    },
                ],
            })),
        }),
    });

    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        totalMessageCount: 2,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: index === 0 ? bobAccount : aliceAccount,
                content: index === 0 ? "First comment." : "Second comment.",
            }),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch", limit: "430b"})).toEqual(`\
Post in [Announcements](/channel/announcements). [Next page »](/post/launch?after=post)

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

Long post paragraph 1 detail detail detail detail detail detail detail detail.

Long post paragraph 2 detail detail detail detail detail detail detail detail.

Long post paragraph 3 detail detail detail detail detail detail detail detail.

(Page truncated, 407b remaining. Showing lines 1-12 of 23. Call the \`scroll\` tool with an \`offset\` of 12 to continue.)`);

    expect(
        await callAgentWebScrollTool(context, {
            path: "/post/launch",
            offset: 12,
            limit: "430b",
        }),
    ).toEqual(`\
Long post paragraph 4 detail detail detail detail detail detail detail detail.

Long post paragraph 5 detail detail detail detail detail detail detail detail.

Long post paragraph 6 detail detail detail detail detail detail detail detail.

Long post paragraph 7 detail detail detail detail detail detail detail detail.

Long post paragraph 8 detail detail detail detail detail detail detail detail.

</post>

(End of file. Showing lines 13-23 of 23.)`);
});

test("before way after message range still able to load the post if there aren\u2019t many messages", async () => {
    mockGetPostReference();
    mockGetPost();
    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        from: "End",
        cursor: 100,
        totalMessageCount: 5,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author, content: `Test comment ${index}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/post/launch?before=100", limit: "20kb"}))
        .toEqual(`\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n
<comment id="0" from="[Alice](/human/alice)">\n\nTest comment 0\n\n</comment>\n
<comment id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 1\n\n</comment>\n
<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 2\n\n</comment>\n
<comment id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest comment 3\n\n</comment>\n
<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest comment 4\n\n</comment>

End of comments.`);
});
