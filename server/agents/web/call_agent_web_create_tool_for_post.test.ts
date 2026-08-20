import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import type {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool as actuallyCallAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentWithoutKeys} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import type {
    ApiAccount,
    ApiChannelReference,
    ApiContent,
    ApiPostReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {
    defaultTimeZone,
    formatTimeZoneAbbreviation,
} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    BotId,
    ChannelId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebCreateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebCreateTool>
): Promise<string> {
    return (await actuallyCallAgentWebCreateTool(...callArguments)).response;
}

async function callAgentWebUpdateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebUpdateTool>
): Promise<string> {
    return (await actuallyCallAgentWebUpdateTool(...callArguments)).response;
}

const spaceId = generateId<SpaceId>();
const announcementsChannelId = generateId<ChannelId>();
const existingPostId = generateId<PostId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const botApiAccount = createApiAccountMock({
    id: botAccountId,
    name: "ChatGPT",
    botId,
});

const announcementsChannelReference: ApiChannelReference = {
    type: "Channel",
    id: announcementsChannelId,
    title: "Announcements",
};

const existingPostReference: ApiPostReference = {
    type: "Post",
    id: existingPostId,
    title: "Existing Post",
};

const {span} = testTracer.startSpan("call_agent_web_create_tool_post.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: botAccountId,
        bot: {id: botId},
    },
};

function mockAgentWebBotAccountReferenceForTest(
    api: ApiClientMock,
    botAccount: AgentWebContext["botAccount"],
): void {
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: botAccount.id}},
        data: {
            reference: {
                type: "Account",
                id: botAccount.id,
                title: "ChatGPT",
                shortName: "ChatGPT",
                bot: botAccount.bot,
            },
        },
    });
}

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: context.botAccount.id,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: context.botAccount.bot,
    });
    assert(actualBotAccountPathname === "/bot/chatgpt");

    const actualAlicePathname = await storeAgentWebPageLinkForTest(storage, aliceAccount);
    assert(actualAlicePathname === "/human/alice");

    const actualAnnouncementsPathname = await storeAgentWebPageLinkForTest(
        storage,
        announcementsChannelReference,
    );
    assert(actualAnnouncementsPathname === "/channel/announcements");

    const actualExistingPostPathname = await storeAgentWebPageLinkForTest(
        storage,
        existingPostReference,
    );
    assert(actualExistingPostPathname === "/post/existing-post");
});

function createTextContent(text: string): ApiContentWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createTextContentWithKeys(text: string): ApiContent {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    });
}

function mockCreatePost({
    id = generateId<PostId>(),
    title,
    author = botApiAccount,
    content = createTextContentWithKeys("Created post response."),
}: {
    id?: PostId;
    title: string;
    author?: ApiAccount;
    content?: ApiContent;
}): PostId {
    api.mockPost("/posts", {
        params: "Any",
        data: {
            spaceId,
            post: {
                id,
                author,
                createdTime: serializeDateString(new Date("2026-05-14T15:00:00.000Z")),
                createdTimeZone: defaultTimeZone,
                channel: {
                    id: announcementsChannelReference.id,
                    name: announcementsChannelReference.title,
                },
                content,
                reference: {title},
            },
        },
    });

    return id;
}

function mockCreateComments({postId, indexes}: {postId: PostId; indexes: ReadonlyArray<number>}) {
    for (const index of indexes) {
        api.mockPost("/posts/{id}/messages", {
            params: {path: {id: postId}},
            data: {
                spaceId,
                message: createApiMessageMock({
                    index,
                    author: botApiAccount,
                    content: "Created comment response",
                }),
            },
        });
    }
}

function getCreatePostRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/posts");
}

function getCreateCommentRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/posts/{id}/messages");
}

test("creates a post without comments", async () => {
    const postId = mockCreatePost({title: "Launch Plan"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>`,
        }),
    ).resolves.toEqual("Create was successful. New post: [Launch Plan](/post/launch-plan).");

    expect(getCreatePostRequests()).toMatchObject([
        {
            body: {
                spaceId,
                post: {
                    channel: {id: announcementsChannelReference.id},
                    content: createTextContent("Launch plan body."),
                },
            },
        },
    ]);
    expect(getCreateCommentRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/post/launch-plan")).toMatchObject({
        pageMetadata: {
            type: "Post",
            id: postId,
            isEndOfMessages: true,
            messages: [],
        },
    });
});

test("creates a post without a from attribute", async () => {
    const postId = mockCreatePost({title: "Implicit Author Launch Plan"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post>

Launch plan body.

</post>`,
        }),
    ).resolves.toEqual(
        "Create was successful. New post: [Implicit Author Launch Plan](/post/implicit-author-launch-plan).",
    );

    expect(getCreatePostRequests()).toMatchObject([
        {
            body: {
                spaceId,
                post: {
                    channel: {id: announcementsChannelReference.id},
                    content: createTextContent("Launch plan body."),
                },
            },
        },
    ]);
    expect(getCreateCommentRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/post/implicit-author-launch-plan")).toMatchObject(
        {
            pageMetadata: {
                type: "Post",
                id: postId,
                isEndOfMessages: true,
                messages: [],
            },
        },
    );
});

test("creates a post without comments with end marker", async () => {
    const postId = mockCreatePost({title: "Launch Plan"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

End of comments.`,
        }),
    ).resolves.toEqual("Create was successful. New post: [Launch Plan](/post/launch-plan).");

    expect(getCreatePostRequests()).toMatchObject([
        {
            body: {
                spaceId,
                post: {
                    channel: {id: announcementsChannelReference.id},
                    content: createTextContent("Launch plan body."),
                },
            },
        },
    ]);
    expect(getCreateCommentRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/post/launch-plan")).toMatchObject({
        pageMetadata: {
            type: "Post",
            id: postId,
            isEndOfMessages: true,
            messages: [],
        },
    });
});

test("creates comments at the same time as creating a post", async () => {
    const postId = mockCreatePost({title: "Launch Comments"});
    mockCreateComments({postId, indexes: [0, 1]});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="0" from="[ChatGPT](/bot/chatgpt)">

First launch comment.

</comment>

<comment id="1" from="[ChatGPT](/bot/chatgpt)">

Second launch comment.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New post: [Launch Comments](/post/launch-comments).",
    );

    expect(getCreatePostRequests()).toMatchObject([
        {
            body: {
                spaceId,
                post: {
                    channel: {id: announcementsChannelReference.id},
                    content: createTextContent("Launch plan body."),
                },
            },
        },
    ]);
    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {content: createTextContent("First launch comment."), createdTimeZone: context.timeZone},
        {content: createTextContent("Second launch comment."), createdTimeZone: context.timeZone},
    ]);
    expect(await storage.readResponseByPath.get("/post/launch-comments")).toMatchObject({
        pageMetadata: {
            type: "Post",
            id: postId,
            isEndOfMessages: true,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("creates comments after creating a post with the update tool", async () => {
    const postId = mockCreatePost({title: "Launch Update Comments"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>`,
        }),
    ).resolves.toEqual(
        "Create was successful. New post: [Launch Update Comments](/post/launch-update-comments).",
    );

    mockCreateComments({postId, indexes: [0, 1]});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/post/launch-update-comments",
            updates: [
                {
                    old: "</post>",
                    new: `\
</post>

<comment from="[ChatGPT](/bot/chatgpt)">

First update comment.

</comment>

<comment from="[ChatGPT](/bot/chatgpt)">

Second update comment.

</comment>

End of comments.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {content: createTextContent("First update comment."), createdTimeZone: context.timeZone},
        {content: createTextContent("Second update comment."), createdTimeZone: context.timeZone},
    ]);
    expect(await storage.readResponseByPath.get("/post/launch-update-comments")).toMatchObject({
        pageMetadata: {
            type: "Post",
            id: postId,
            isEndOfMessages: true,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("throws UnimplementedError when updating a created post without a from attribute", async () => {
    mockCreatePost({title: "Implicit Author Update"});

    await callAgentWebCreateTool(context, {
        type: "post",
        content: `\
Post in [Announcements](/channel/announcements).

<post>

Launch plan body.

</post>`,
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/post/implicit-author-update",
            updates: [
                {
                    old: "Launch plan body.",
                    new: "Edited launch plan body.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/post/implicit-author-update\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Post update content API endpoint hasn\u2019t been implemented yet`);
});

test("allows adding the current account from attribute to a created post without a from attribute", async () => {
    mockCreatePost({title: "Implicit Author From"});

    await callAgentWebCreateTool(context, {
        type: "post",
        content: `\
Post in [Announcements](/channel/announcements).

<post>

Launch plan body.

</post>`,
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/post/implicit-author-from",
            updates: [
                {
                    old: "<post>",
                    new: '<post from="[ChatGPT](/bot/chatgpt)">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");
});

test("rejects adding another account from attribute to a created post without a from attribute", async () => {
    mockCreatePost({title: "Implicit Author Other"});

    await callAgentWebCreateTool(context, {
        type: "post",
        content: `\
Post in [Announcements](/channel/announcements).

<post>

Launch plan body.

</post>`,
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/post/implicit-author-other",
            updates: [
                {
                    old: "<post>",
                    new: '<post from="[Alice](/human/alice)">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/post/implicit-author-other`. " +
            "You can only update the content of your `<post>`s. Any metadata (the `from`/`timezone` attributes) must be left unchanged. The metadata of the `<post>` was changed by this update. Try again with a more specific update that only changes the content of your post.",
    );
});

test("rejects creating a post without a channel", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post that\u2019s not in any channel.

<post from="[ChatGPT](/bot/chatgpt)">

No channel.

</post>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "A channel is required when creating a `<post>`. You must add a `Post in [My Channel](/channel/my-channel).` line at the start of the post markdown with the channel you want to create the post in. Try again and add a channel.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comments page instead of a post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Comments on [post](/post/existing-post).

<comment from="[ChatGPT](/bot/chatgpt)">

This is not a post.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "A channel is required when creating a `<post>`. You must add a `Post in [My Channel](/channel/my-channel).` line at the start of the post markdown with the channel you want to create the post in. Try again and add a channel.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a post with a next page link", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements). [Next page »](/post/existing-post?after=post)

<post from="[ChatGPT](/bot/chatgpt)">

The server should create this as a new post, not a paginated page.

</post>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "Can\u2019t add \u201cNext page »\u201d link when creating comments markdown. Try again without the \u201cNext page »\u201d link.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a post with a time marker before the post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[ChatGPT](/bot/chatgpt)">

Server should choose the post time.

</post>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "Unexpected `<time>`, you can only add a `<post>`. The creation time of the post will be decided by the server. Try again and remove the new `<time>`.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a post from another account", async () => {
    mockAgentWebBotAccountReferenceForTest(api, context.botAccount);

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[Alice](/human/alice)">

Not from the bot.

</post>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            'You can only create a `<post>` as yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("creates a post with a timezone attribute", async () => {
    const postId = mockCreatePost({title: "Explicit Timezone"});
    const timeZoneAttribute = formatTimeZoneAbbreviation(context.timeZone, new Date());

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)" timezone="${timeZoneAttribute}">

Timezone is explicit.

</post>`,
        }),
    ).resolves.toEqual(
        "Create was successful. New post: [Explicit Timezone](/post/explicit-timezone).",
    );
    expect(getCreatePostRequests()).toMatchObject([
        {body: {post: {createdTimeZone: context.timeZone}}},
    ]);
    expect(getCreateCommentRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/post/explicit-timezone")).toMatchObject({
        pageMetadata: {id: postId, createdTimeZone: context.timeZone},
    });
});

test("rejects creating a comment from another account while creating a post", async () => {
    mockAgentWebBotAccountReferenceForTest(api, context.botAccount);

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[Alice](/human/alice)">

Not from the bot.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            'You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comment with an incorrect id while creating a post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="3" from="[ChatGPT](/bot/chatgpt)">

Wrong id.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            'Invalid `id` attribute for new `<comment>`. The `<comment>` `id` attribute is an integer sequence so the next valid `id` is 0. Try again with `id="0"`.',
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comment with a time attribute while creating a post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">

Server should choose the comment time.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "You can\u2019t add a `<comment>` with a `time` attribute. The creation time of the comment will be decided by the server. Try again without the `time` attribute.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a time marker after the post while creating a post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<time>May 14th at 11:05am EDT</time>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create post. " +
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("reports a partial success when created comment indexes are unexpected", async () => {
    const postId = mockCreatePost({title: "Racing Comment"});
    mockCreateComments({postId, indexes: [2]});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[ChatGPT](/bot/chatgpt)">

Created after another comment.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(`\
Create was successful. New post: [Racing Comment](/post/racing-comment).

Between the last comment you read and the comment you created there are some new comments from others you haven\u2019t seen. These new comments may not be relevant to you, but if you want to see them anyway you can call the \`read\` tool with \`/post/racing-comment?start\`.`);
    expect(getCreatePostRequests()).toHaveLength(1);
    expect(getCreateCommentRequests()).toHaveLength(1);
});

test("throws UnimplementedError when creating a reply comment while creating a post", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="0" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?comment=0">

[ChatGPT](/bot/chatgpt): Parent comment

</blockquote>

Replying to the parent.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t create post. Couldn\u2019t find `<comment id="0">` referenced by `<blockquote cite="?comment=0">` on the current page. To create a comment that replies to another comment, the cited comment must be visible on the current page. If you\u2019re trying to quote a comment that\u2019s not on this page then call the `read` tool with a larger `limit` so that the comment you\u2019re replying to is on the same page you\u2019re updating. Try again without the `<blockquote>`, with a different `cite` attribute that references a message on the current page, or with a larger limit when calling `read` so the `<comment>` you\u2019re replying to is on the same page you\u2019re updating.',
    );
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("creates a comment with a timezone attribute while creating a post", async () => {
    const postId = mockCreatePost({title: "Timezone Comment"});
    mockCreateComments({postId, indexes: [0]});
    const timeZoneAttribute = formatTimeZoneAbbreviation(context.timeZone, new Date());

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="0" from="[ChatGPT](/bot/chatgpt)" timezone="${timeZoneAttribute}">

Timezone is explicit.

</comment>

End of comments.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New post: [Timezone Comment](/post/timezone-comment).",
    );
    expect(getCreatePostRequests()).toHaveLength(1);
    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Timezone is explicit."),
            createdTimeZone: context.timeZone,
        },
    ]);
});
