import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import type {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import type {
    ApiAccount,
    ApiChannelReferenceResponse,
    ApiContentResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import type {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import type {AccountId, BotId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

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

const announcementsChannelReference: ApiChannelReferenceResponse = {
    type: "Channel",
    id: announcementsChannelId,
    title: "Announcements",
};

const existingPostReference: ApiPostReferenceResponse = {
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
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

type UpdateToolUpdate = Parameters<typeof callAgentWebUpdateTool>[1]["updates"][number];

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const actualAlicePathname = await createAgentWebPageStoredLinkPathname(
        storage,
        intoApiAccountReference(aliceAccount),
    );
    assert(actualAlicePathname === "/human/alice");

    const actualAnnouncementsPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        announcementsChannelReference,
    );
    assert(actualAnnouncementsPathname === "/channel/announcements");

    const actualExistingPostPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        existingPostReference,
    );
    assert(actualExistingPostPathname === "/post/existing-post");
});

function createTextContent(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createTextContentWithKeys(text: string): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Test", version: 0}).encode({
                    pos: 0,
                    nodeSize: text.length + 2,
                }),
                elements: [{type: "Text", text}],
            },
        ],
    };
}

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
                string += segment.text;
                break;
            case "Link":
                string += segment.text;
                break;
            default:
                throw exhaustive(segment);
        }
    }

    return string;
}

function getDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage) {
        return error.displayMessage;
    }

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage) {
                return childError.displayMessage;
            }
        }
    }

    throw error;
}

async function expectCreateDisplayMessage({
    content,
    expected,
    ErrorConstructor,
}: {
    content: string;
    expected: string;
    ErrorConstructor: typeof InvalidArgumentError | typeof FailedPreconditionError;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "post", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(ErrorConstructor);
}

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    await expectCreateDisplayMessage({content, expected, ErrorConstructor: InvalidArgumentError});
}

async function expectInvalidUpdateDisplayMessage({
    path,
    updates,
    expected,
}: {
    path: string;
    updates: ReadonlyArray<UpdateToolUpdate>;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebUpdateTool(context, {path, updates}),
    );

    if (result.ok) {
        throw new InternalError("Expected update tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
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
    content?: ApiContentResponse;
}): PostId {
    api.mockPost("/posts", {
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
        api.mockPost(
            "/posts/{id}/messages",
            {
                data: {
                    spaceId,
                    message: createApiMessageMock({
                        index,
                        author: botApiAccount,
                        content: "Created comment response",
                    }),
                },
            },
            {path: {id: postId}},
        );
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
    ).resolves.toEqual("Create was successful. New post: [Launch Plan](/post/launch-plan).\n");

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
        "Create was successful. New post: [Implicit Author Launch Plan](/post/implicit-author-launch-plan).\n",
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
    ).resolves.toEqual("Create was successful. New post: [Launch Plan](/post/launch-plan).\n");

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
        "Create was successful. New post: [Launch Comments](/post/launch-comments).\n",
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
        {content: createTextContent("First launch comment.")},
        {content: createTextContent("Second launch comment.")},
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
        "Create was successful. New post: [Launch Update Comments](/post/launch-update-comments).\n",
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
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {content: createTextContent("First update comment.")},
        {content: createTextContent("Second update comment.")},
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
    ).rejects.toThrow(UnimplementedError);
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
    ).resolves.toEqual("Update was successful.\n");
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

    await expectInvalidUpdateDisplayMessage({
        path: "/post/implicit-author-other",
        updates: [
            {
                old: "<post>",
                new: '<post from="[Alice](/human/alice)">',
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the content of your `<post>`s. Any metadata (the `from`/`timezone` attributes) must be left unchanged. The metadata of the `<post>` was changed by this update. Try again with a more specific update that only changes the content of your post.",
    });
});

test("rejects creating a post without a channel", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post that\u2019s not in any channel.

<post from="[ChatGPT](/bot/chatgpt)">

No channel.

</post>`,
        expected:
            "A channel is required when creating a `<post>`. You must add a `Post in [My Channel](/channel/my-channel).` line at the start of the post markdown with the channel you want to create the post in. Try again and add a channel.",
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comments page instead of a post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Comments on [post](/post/existing-post).

<comment from="[ChatGPT](/bot/chatgpt)">

This is not a post.

</comment>

End of comments.`,
        expected:
            "A channel is required when creating a `<post>`. You must add a `Post in [My Channel](/channel/my-channel).` line at the start of the post markdown with the channel you want to create the post in. Try again and add a channel.",
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a post with a time marker before the post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<time>May 14th at 11:00am EDT</time>

<post from="[ChatGPT](/bot/chatgpt)">

Server should choose the post time.

</post>`,
        expected:
            "Unexpected `<time>`, you can only add a `<post>`. The creation time of the post will be decided by the server. Try again and remove the new `<time>`.",
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a post from another account", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[Alice](/human/alice)">

Not from the bot.

</post>`,
        expected:
            'You can only create a `<post>` as yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("throws UnimplementedError when creating a post with a timezone attribute", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)" timezone="EDT">

Timezone is explicit.

</post>`,
        }),
    ).rejects.toThrow(UnimplementedError);
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comment from another account while creating a post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[Alice](/human/alice)">

Not from the bot.

</comment>

End of comments.`,
        expected:
            'You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comment with an incorrect id while creating a post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="3" from="[ChatGPT](/bot/chatgpt)">

Wrong id.

</comment>

End of comments.`,
        expected:
            'Invalid `id` attribute for new `<comment>`. The `<comment>` `id` attribute is an integer sequence so the next valid `id` is `0`. Try again with `id="0"`.',
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a comment with a time attribute while creating a post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">

Server should choose the comment time.

</comment>

End of comments.`,
        expected:
            "You can\u2019t add a `<comment>` with a `time` attribute. The creation time of the comment will be decided by the server. Try again without the `time` attribute.",
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("rejects creating a time marker after the post while creating a post", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<time>May 14th at 11:05am EDT</time>`,
        expected:
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    });
    expect(getCreatePostRequests()).toEqual([]);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("reports a partial success when created comment indexes are unexpected", async () => {
    const postId = mockCreatePost({title: "Racing Comment"});
    mockCreateComments({postId, indexes: [2]});

    await expectCreateDisplayMessage({
        content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment from="[ChatGPT](/bot/chatgpt)">

Created after another comment.

</comment>

End of comments.`,
        expected:
            "Update was successful, the comment you added was created. But between the last comment you read and the comment you created there are some new comments from others you haven\u2019t seen. These new comments may not be relevant to you, but if you want to see them anyway you can call the `read` tool with `/post/racing-comment?start`. (This create was a partial success. Try to figure out which parts of the create were successful before trying again.)",
        ErrorConstructor: FailedPreconditionError,
    });
    expect(getCreatePostRequests()).toHaveLength(1);
    expect(getCreateCommentRequests()).toHaveLength(1);
});

test("throws UnimplementedError when creating a reply comment while creating a post", async () => {
    mockCreatePost({title: "Reply Comment"});

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
    ).rejects.toThrow(UnimplementedError);
    expect(getCreatePostRequests()).toHaveLength(1);
    expect(getCreateCommentRequests()).toEqual([]);
});

test("throws UnimplementedError when creating a comment with a timezone attribute while creating a post", async () => {
    mockCreatePost({title: "Timezone Comment"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "post",
            content: `\
Post in [Announcements](/channel/announcements).

<post from="[ChatGPT](/bot/chatgpt)">

Launch plan body.

</post>

<comment id="0" from="[ChatGPT](/bot/chatgpt)" timezone="EDT">

Timezone is explicit.

</comment>

End of comments.`,
        }),
    ).rejects.toThrow(UnimplementedError);
    expect(getCreatePostRequests()).toHaveLength(1);
    expect(getCreateCommentRequests()).toEqual([]);
});
