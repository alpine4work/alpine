import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    ApiMessageMockParent,
    createApiMessageMock,
} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetPostMessages} from "~/server/agents/api/test_helpers/mock_api_get_post_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountResponse,
    ApiChannelReferenceResponse,
    ApiContentResponse,
    ApiMessageResponse,
    ApiPostReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const postId = generateId<PostId>();
const otherPostId = generateId<PostId>();
const announcementsChannelId = generateId<ChannelId>();
const productUpdatesChannelId = generateId<ChannelId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
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

const productUpdatesChannelReference: ApiChannelReferenceResponse = {
    type: "Channel",
    id: productUpdatesChannelId,
    title: "Product Updates",
};

const postReference: ApiPostReferenceResponse = {
    type: "Post",
    id: postId,
    title: "Launch",
};

const otherPostReference: ApiPostReferenceResponse = {
    type: "Post",
    id: otherPostId,
    title: "Roadmap",
};

const postPath = "/post/launch";
const otherPostPath = "/post/roadmap";

const {span} = testTracer.startSpan("call_agent_web_update_tool_post.test.ts");
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

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const actualPostPathname = await createAgentWebPageStoredLinkPathname(storage, postReference);
    assert(actualPostPathname === postPath);

    const actualOtherPostPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        otherPostReference,
    );
    assert(actualOtherPostPathname === otherPostPath);

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Account",
        id: aliceAccount.id,
        title: aliceAccount.name,
        shortName: aliceAccount.shortName,
        bot: aliceAccount.bot,
    });
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Account",
        id: bobAccount.id,
        title: bobAccount.name,
        shortName: bobAccount.shortName,
        bot: bobAccount.bot,
    });
    await createAgentWebPageStoredLinkPathname(storage, announcementsChannelReference);
    await createAgentWebPageStoredLinkPathname(storage, productUpdatesChannelReference);
});

type UpdateToolUpdate = Parameters<typeof callAgentWebUpdateTool>[1]["updates"][number];

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

async function expectInvalidUpdateDisplayMessage({
    path = postPath,
    updates,
    expected,
}: {
    path?: string;
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

function createTextContent(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createTextContentWithKeys(text: string): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    });
}

function createComment({
    index,
    author = index % 2 === 0 ? aliceAccount : bobAccount,
    content = `Comment ${index}`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
    parent,
}: {
    index: number;
    author?: ApiAccountResponse;
    content?: ApiContentResponse | string;
    createdTime?: string;
    parent?: ApiMessageMockParent;
}): ApiMessageResponse {
    return createApiMessageMock({
        index,
        author,
        content,
        createdTime,
        parent,
    });
}

function getReadPageInfo(path: string): {
    from?: "Start" | "End";
    cursor?: number;
} {
    const url = new UrlPath(path);

    if (url.searchParams.has("start")) {
        return {};
    }

    const after = url.searchParams.get("after");
    if (after !== null) {
        if (after === "post") return {};
        return {cursor: parseInt(after, 10)};
    }

    const before = url.searchParams.get("before");
    if (before !== null) {
        return {from: "End", cursor: before === "post" ? 0 : parseInt(before, 10)};
    }

    return {};
}

function mockGetPost({
    author = aliceAccount,
    channel = announcementsChannelReference,
    content = createTextContentWithKeys("Post body."),
    createdTime = new Date("2026-05-14T15:00:00.000Z"),
    createdTimeZone = defaultTimeZone,
}: {
    author?: ApiAccountResponse;
    channel?: ApiChannelReferenceResponse | null;
    content?: ApiContentResponse;
    createdTime?: Date;
    createdTimeZone?: TimeZone;
} = {}) {
    api.mockGet("/posts/{id}", {
        params: {path: {id: postId}},
        data: {
            spaceId,
            post: {
                id: postId,
                author,
                createdTime: serializeDateString(createdTime),
                createdTimeZone,
                channel:
                    channel === null
                        ? undefined
                        : {
                              id: channel.id,
                              name: channel.title,
                          },
                content,
                reference: {title: postReference.title},
            },
        },
    });
}

function mockGetPostReference(reference = postReference) {
    api.mockGet("/posts/{id}-reference", {
        params: {path: {id: postId}},
        data: {
            spaceId,
            reference,
        },
    });
}

async function readPost({
    path = postPath,
    limit = "100kb",
    totalCommentCount,
    createComment: actuallyCreateComment,
    postAuthor = aliceAccount,
}: {
    path?: string;
    limit?: string;
    totalCommentCount: number;
    createComment?: (index: number) => ApiMessageResponse;
    postAuthor?: ApiAccountResponse;
}): Promise<string> {
    if (path.includes("after=") || path.includes("before=")) {
        mockGetPostReference();
    } else {
        mockGetPost({author: postAuthor});
    }

    mockApiGetPostMessages(api, {
        spaceId,
        postId,
        ...getReadPageInfo(path),
        totalMessageCount: totalCommentCount,
        limit: 30,
        createMessage:
            actuallyCreateComment ??
            (index => createComment({index, author: index % 2 === 0 ? aliceAccount : bobAccount})),
    });

    return await callAgentWebReadTool(context, {path, limit});
}

function mockCreateComments({count, startIndex = 0}: {count: number; startIndex?: number}) {
    for (let index = 0; index < count; index++) {
        api.mockPost("/posts/{id}/messages", {
            params: {path: {id: postId}},
            data: {
                spaceId,
                message: createComment({
                    index: startIndex + index,
                    author: botApiAccount,
                    content: "Created comment response",
                }),
            },
        });
    }
}

function getCreateCommentRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/posts/{id}/messages");
}

function getLastCommentBlock(response: string): string {
    const startIndex = response.lastIndexOf("\n\n<comment");
    assert(startIndex !== -1);
    return response.slice(startIndex + 2);
}

test("creates the first comment on a post", async () => {
    await readPost({totalCommentCount: 0});
    mockCreateComments({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [
                {
                    old: "</post>",
                    new: '</post>\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nFirst bot comment.\n\n</comment>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
        },
    ]);
});

test("creates the first comment on a post with end marker", async () => {
    await readPost({totalCommentCount: 0});
    mockCreateComments({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [
                {
                    old: "</post>",
                    new: '</post>\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nFirst bot comment.\n\n</comment>\n\nEnd of comments.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
        },
    ]);
});

test("rejects converting a head post page to a tail comments page", async () => {
    await readPost({totalCommentCount: 0});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: 'Post in [Announcements](/channel/announcements).\n\n<time>May 14th at 11:00am EDT</time>\n\n<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>',
                new: "Comments on [post](/post/launch).",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<post>`s and `<comment>`s. You must leave the `Post in [My Channel](/channel/my-channel).` line at the start of the post markdown in place. Try again with a more specific update that only changes the content of the post (if it\u2019s from you) or adds new comments.",
    });
});

test("rejects moving a post to a different channel", async () => {
    await readPost({totalCommentCount: 0});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "Post in [Announcements](/channel/announcements).",
                new: "Post in [Product Updates](/channel/product-updates).",
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t currently move a post to a different channel. Try again with a more specific update that only changes the content of the post (if it\u2019s from you) or adds new comments.",
    });
});

test("rejects converting a tail comments page to a head post page", async () => {
    const path = `${postPath}?after=0`;
    await readPost({path, totalCommentCount: 1});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "Comments on [post](/post/launch).\n\nEnd of comments.",
                new: 'Post in [Announcements](/channel/announcements).\n\n<time>May 14th at 11:00am EDT</time>\n\n<post from="[Alice](/human/alice)">\n\nPost body.\n\n</post>\n\nEnd of comments.',
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<comment>`s. You must leave the `Comments on [post](/post/my-post).` line at the start of the post markdown in place. Try again with a more specific update that only changes the content comments from you or adds new comments.",
    });
});

test("rejects changing which post a tail comments page belongs to", async () => {
    const path = `${postPath}?after=0`;
    await readPost({path, totalCommentCount: 1});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "Comments on [post](/post/launch).",
                new: "Comments on [post](/post/roadmap).",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<comment>`s. You can\u2019t change which post the comments belong to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    });
});

test("rejects edits to posts from another account", async () => {
    await readPost({totalCommentCount: 0});

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "Post body.", new: "Edited post body.", replaceAll: false}],
        expected:
            'You can only update your `<post>`s. You can\u2019t update a `<post>` created by Alice. `<post from="Alice">` was changed by this update. Try again with a more specific update that only changes the content of comments from you or adds new comments.',
    });
});

test("rejects edits to existing bot post metadata", async () => {
    await readPost({totalCommentCount: 0, postAuthor: botApiAccount});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: '<post from="[ChatGPT](/bot/chatgpt)">',
                new: '<post from="[Alice](/human/alice)">',
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the content of your `<post>`s. Any metadata (the `from`/`timezone` attributes) must be left unchanged. The metadata of the `<post>` was changed by this update. Try again with a more specific update that only changes the content of your post.",
    });
});

test("throws UnimplementedError when updating existing bot post content", async () => {
    await readPost({totalCommentCount: 0, postAuthor: botApiAccount});

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [{old: "Post body.", new: "Edited bot post body.", replaceAll: false}],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("rejects pagination link edits", async () => {
    const response = await readPost({
        path: `${postPath}?start`,
        limit: "650b",
        totalCommentCount: 20,
        createComment: index => createComment({index, content: `Existing comment ${index}`}),
    });
    expect(response).toContain("[Next page \u00bb](/post/launch?after=");

    await expectInvalidUpdateDisplayMessage({
        path: `${postPath}?start`,
        updates: [
            {
                old: "?after=3",
                new: "?after=7",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<comment>`s. You can\u2019t update the previous/next page links in the comments markdown. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    });
});

test("rejects time marker edits", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index => createComment({index, content: "Existing comment"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "11:00am",
                new: "12:00pm",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<comment>`s. You can\u2019t update `<time>`s which indicate when previous `<comment>`s were sent. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    });
});

test("rejects edits to comments from another account", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: aliceAccount, content: "Alice original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "Alice original", new: "Alice edited by ChatGPT", replaceAll: false}],
        expected:
            'You can only update your `<comment>`s. You can\u2019t update a `<comment>` created by Alice. `<comment id="0" from="Alice">` was changed by this update. Try again with a more specific update that only changes the content of comments from you or adds new comments.',
    });
});

test("rejects edits to existing bot comment metadata", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: botApiAccount, content: "Bot original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: 'id="0" from="[ChatGPT',
                new: 'id="7" from="[ChatGPT',
                replaceAll: false,
            },
        ],
        expected:
            'You can only update the content of your `<comment>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<comment id="0">` was changed by this update. Try again with a more specific update that only changes the content of comments from you.',
    });
});

test("rejects removing comment blocks", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index => createComment({index, author: bobAccount, content: "Bob comment"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: '\n\n<comment id="0" from="[Bob](/human/bob)">\n\nBob comment\n\n</comment>',
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t remove `<comment>`s. If you want to delete one of your `<comment>`s, then delete all the content of your `<comment>`. You can only delete your own `<comment>`s. Try again with a more specific update that only changes the content of comments from you.",
    });
});

test("rejects creating comments before the end of the post comments", async () => {
    const path = `${postPath}?start`;
    const response = await readPost({path, limit: "650b", totalCommentCount: 20});
    const lastCommentBlock = getLastCommentBlock(response);

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: lastCommentBlock,
                new: `${lastCommentBlock}\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nToo early.\n\n</comment>`,
                replaceAll: false,
            },
        ],
        expected:
            "You can only add a `<comment>` after all other comments (comments are in chronological order). Look for \u201cEnd of comments\u201d to know when you\u2019re at the end of a comment section. Call the `read` tool with `/post/launch?end` to jump to the end of a comment section.",
    });
});

test("rejects creating comments from another account", async () => {
    await readPost({totalCommentCount: 0});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "</post>",
                new: '</post>\n\n<comment from="[Alice](/human/alice)">\n\nNot from the bot.\n\n</comment>',
                replaceAll: false,
            },
        ],
        expected:
            'You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
});

test("rejects creating comments with an incorrect id", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index => createComment({index, content: "Existing comment"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of comments.",
                new: '\n\n<comment id="3" from="[ChatGPT](/bot/chatgpt)">\n\nWrong id.\n\n</comment>\n\nEnd of comments.',
                replaceAll: false,
            },
        ],
        expected:
            'Invalid `id` attribute for new `<comment>`. The `<comment>` `id` attribute is an integer sequence so the next valid `id` is `1`. Try again with `id="1"`.',
    });
});

test("rejects creating comments with a time attribute", async () => {
    await readPost({totalCommentCount: 0});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "</post>",
                new: '</post>\n\n<comment from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">\n\nServer should choose the time.\n\n</comment>',
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t add a `<comment>` with a `time` attribute. The creation time of the comment will be decided by the server. Try again without the `time` attribute.",
    });
});

test("rejects adding the end marker to a non-final comments page", async () => {
    const path = `${postPath}?start`;
    const response = await readPost({path, limit: "650b", totalCommentCount: 20});
    const lastCommentBlock = getLastCommentBlock(response);

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: lastCommentBlock,
                new: `${lastCommentBlock}\n\nEnd of comments.`,
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t add the \u201cEnd of comments\u201d marker in an update. Only a `read` tool call can tell you whether you\u2019re at the end of a comment section or not. Try again without adding the \u201cEnd of comments\u201d marker.",
    });
});

test("throws UnimplementedError when updating existing bot comment content", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [{old: "Bot original", new: "Bot edited", replaceAll: false}],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("throws UnimplementedError when deleting existing bot comment content", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [{old: "Bot original", new: "", replaceAll: false}],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("throws UnimplementedError when creating a reply comment", async () => {
    await readPost({
        totalCommentCount: 1,
        createComment: index =>
            createComment({index, author: aliceAccount, content: "Parent comment"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [
                {
                    old: "\n\nEnd of comments.",
                    new: '\n\n<comment id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?comment=0">\n\n[Alice](/human/alice): Parent comment\n\n</blockquote>\n\nReplying to the parent.\n\n</comment>\n\nEnd of comments.',
                    replaceAll: false,
                },
            ],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("throws UnimplementedError when creating a comment with a timezone attribute", async () => {
    await readPost({totalCommentCount: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: postPath,
            updates: [
                {
                    old: "\n\n</post>",
                    new: '\n\n</post>\n\n<comment id="0" from="[ChatGPT](/bot/chatgpt)" timezone="EDT">\n\nTimezone is explicit.\n\n</comment>\n\nEnd of comments.',
                    replaceAll: false,
                },
            ],
        }),
    ).rejects.toThrow(UnimplementedError);
});
