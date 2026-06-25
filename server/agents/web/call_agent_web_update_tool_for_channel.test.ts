import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebChannelPageApiPostsBatchCount} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/markdown/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
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
import {DateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const channelId = generateId<ChannelId>();
const launchPostId = generateId<PostId>();
const roadmapPostId = generateId<PostId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_channel.test.ts");
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

type UpdateToolUpdate = Parameters<typeof callAgentWebUpdateTool>[1]["updates"][number];

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
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    });
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

async function expectInvalidUpdateDisplayMessage({
    path = "/channel/announcements",
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

async function expectUnimplementedUpdate({
    path = "/channel/announcements",
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

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty("message", expected);
}

function mockGetChannel() {
    api.mockGet(
        "/channels/{id}",
        {
            data: {
                spaceId,
                channel: {
                    id: channelId,
                    name: "Announcements",
                    description: contentFromText("Updates from the team."),
                },
            },
        },
        {path: {id: channelId}},
    );
}

function mockGetChannelPosts({
    cursor,
    totalPostCount = 2,
}: {
    cursor?: DateString;
    totalPostCount?: number;
} = {}) {
    const posts = [
        {
            id: launchPostId,
            author: aliceAccount,
            createdTime: serializeDateString(new Date("2026-05-14T15:00:00.000Z")),
            createdTimeZone: defaultTimeZone,
            channel: {id: channelId, name: "Announcements"},
            contentSnippet: contentFromText("Launch summary."),
            reference: {title: "Launch notes"},
        },
        {
            id: roadmapPostId,
            author: bobAccount,
            createdTime: serializeDateString(new Date("2026-05-14T15:05:00.000Z")),
            createdTimeZone: defaultTimeZone,
            channel: {id: channelId, name: "Announcements"},
            contentSnippet: contentFromText("Roadmap summary."),
            reference: {title: "Roadmap"},
        },
    ];

    const extraPosts = Array.from({length: Math.max(totalPostCount - posts.length, 0)}, (_, i) => {
        const index = i + posts.length;
        return {
            id: generateId<PostId>(),
            author: index % 2 === 0 ? aliceAccount : bobAccount,
            createdTime: serializeDateString(new Date(Date.UTC(2026, 4, 14, 15, index * 5))),
            createdTimeZone: defaultTimeZone,
            channel: {id: channelId, name: "Announcements"},
            contentSnippet: contentFromText(`Extra summary ${index + 1}.`),
            reference: {title: `Extra post ${index + 1}`},
        };
    });

    const allPosts = [...posts, ...extraPosts];
    const startIndex =
        cursor === undefined
            ? 0
            : allPosts.findIndex(post => new Date(post.createdTime) > new Date(cursor));
    const safeStartIndex = startIndex === -1 ? allPosts.length : startIndex;
    const returnedPosts = allPosts.slice(
        safeStartIndex,
        safeStartIndex + agentWebChannelPageApiPostsBatchCount,
    );
    const nextPost = allPosts[safeStartIndex + returnedPosts.length];

    api.mockGet(
        "/channels/{id}/posts",
        {
            data: {
                spaceId,
                channel: {
                    id: channelId,
                    name: "Announcements",
                },
                nextCursor: nextPost ? returnedPosts[returnedPosts.length - 1]!.createdTime : null,
                posts: returnedPosts,
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

async function readHeadChannelPage({
    totalPostCount = 2,
    limit = "10kb",
}: {
    totalPostCount?: number;
    limit?: string;
} = {}) {
    mockGetChannel();
    mockGetChannelPosts({totalPostCount});

    return await callAgentWebReadTool(context, {
        path: "/channel/announcements",
        limit,
    });
}

test("throws unimplemented when updating the channel name", async () => {
    await readHeadChannelPage();

    await expectUnimplementedUpdate({
        updates: [{old: "# Announcements", new: "# Product Updates", replaceAll: false}],
        expected: "Channel rename API endpoint hasn\u2019t been implemented yet",
    });
});

test("throws unimplemented when updating the channel description", async () => {
    await readHeadChannelPage();

    await expectUnimplementedUpdate({
        updates: [
            {
                old: "Updates from the team.",
                new: "Updates from the product team.",
                replaceAll: false,
            },
        ],
        expected: "Channel description update API endpoint hasn\u2019t been implemented yet",
    });
});

test("rejects converting a head channel page into a tail channel page", async () => {
    const response = await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: response,
                new: `\
Posts in Announcements.

End of posts.`,
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description. Try again with a channel name as a markdown h1 (e.g. `# My Channel`) on line 1 of the channel markdown.",
    });
});

test("rejects pagination link edits", async () => {
    const response = await readHeadChannelPage({totalPostCount: 16, limit: "720b"});
    const paginationLink = response.match(/\[Next page »\]\([^)]+\)/)?.[0];
    assert(paginationLink);

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: paginationLink,
                new: "[Next page »](/channel/announcements?after=2026-05-14T16:10)",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description on a channel page. You can\u2019t update the next page link in channel markdown. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects adding posts", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "End of posts.",
                new: `\
<post>

New post summary.

</post>

End of posts.`,
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t add `<post>`s with the `update` tool on a channel page. Call the `create` tool with `type` of `post` with each post you want to create.",
    });
});

test("rejects removing posts", async () => {
    const response = await readHeadChannelPage();
    const firstPostMatch = response.match(
        /<post from="\[Alice\]\(\/human\/alice\)" time="May 14th at 11:00am EDT">[\s\S]*?<\/post>\n\n/,
    );
    assert(firstPostMatch);
    const firstPost = firstPostMatch[0];

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: firstPost, new: "", replaceAll: false}],
        expected:
            "You can only update the channel name and description on a channel page. You can\u2019t remove `<post>`s. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects changing a post see more link", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "[See more »](/post/launch-notes)",
                new: "[See more »](/post/roadmap)",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects removing a post see more link", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\n[See more »](/post/launch-notes)",
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects changing a post time attribute", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: 'time="May 14th at 11:00am EDT"',
                new: 'time="May 14th at 11:01am EDT"',
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects changing a post from attribute", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: 'from="[Alice](/human/alice)"',
                new: 'from="[Bob](/human/bob)"',
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    });
});

test("rejects changing a post content snippet", async () => {
    await readHeadChannelPage();

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "Launch summary.", new: "Updated launch summary.", replaceAll: false}],
        expected:
            "You can only update the channel name and description on a channel page. You can\u2019t change a `<post>`\u2019s content. To update a post, call the `read` tool with the post\u2019s \u201CSee more\u201D link and then call the `update` tool on the post page.",
    });
});

test("rejects adding an end of posts marker to a non-final page", async () => {
    const response = await readHeadChannelPage({totalPostCount: 16, limit: "720b"});
    const postMatches = [...response.matchAll(/<post[\s\S]*?<\/post>/g)];
    const lastPost = postMatches[postMatches.length - 1]?.[0];
    assert(lastPost);

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: lastPost,
                new: `\
${lastPost}

End of posts.`,
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t add the \u201cEnd of posts\u201d marker in an update. Only a `read` tool call can tell you whether you\u2019ve seen all of a channel\u2019s posts. Try again without adding the \u201cEnd of posts\u201d marker.",
    });
});

test("rejects changing the tail page preamble", async () => {
    const cursor = serializeDateString(new Date("2026-05-14T15:00:00.000Z"));
    mockGetChannelPosts({cursor, totalPostCount: 2});

    await callAgentWebReadTool(context, {
        path: `/channel/announcements?after=${cursor}`,
        limit: "10kb",
    });

    await expectInvalidUpdateDisplayMessage({
        path: `/channel/announcements?after=${cursor}`,
        updates: [
            {
                old: "Posts in Announcements.",
                new: "Posts in Product Updates.",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name on the first page of the channel. You must leave the `Posts in My Channel.` line at the start of the channel markdown in place. Try calling the `read` tool to navigate to the first page in the channel and you can call the `update` tool on that page to update the channel name.",
    });
});

test("rejects converting a tail channel page into a head channel page", async () => {
    const cursor = serializeDateString(new Date("2026-05-14T15:00:00.000Z"));
    const path = `/channel/announcements?after=${cursor}`;
    const response = await (async () => {
        mockGetChannelPosts({cursor, totalPostCount: 2});

        return await callAgentWebReadTool(context, {
            path,
            limit: "10kb",
        });
    })();

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: response,
                new: `\
# Announcements

Updates from the team.

---

End of posts.`,
                replaceAll: false,
            },
        ],
        expected:
            "You can only update the channel name on the first page of the channel. You must leave the `Posts in My Channel.` line at the start of the channel markdown in place. Try calling the `read` tool to navigate to the first page in the channel and you can call the `update` tool on that page to update the channel name.",
    });
});
