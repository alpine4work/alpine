import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {agentWebChannelPageApiPostsBatchCount} from "~/server/agents/web/pages/agent_web_channel_page.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {DateString, serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
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

beforeEach(async () => {
    await storage.deleteAll();
    await storeAgentWebPageLinkForTest(storage, [
        context.botAccount,
        {
            type: "Channel",
            id: channelId,
            title: "Announcements",
        },
    ]);
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

function contentWithoutKeysFromText(text: string): ApiContentResponseWithoutKeys {
    return {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    };
}

function mockPatchChannel({
    name = "Announcements",
    description = contentFromText("Updates from the team."),
}: {
    name?: string;
    description?: ApiContentResponse;
} = {}) {
    api.mockPatch("/channels/{id}", {
        params: {path: {id: channelId}},
        data: {
            spaceId,
            channel: {
                id: channelId,
                name,
                description,
            },
        },
    });
}

function getChannelPatchRequests() {
    return api
        .getRequestHistory()
        .filter(record => record.method === "PATCH" && record.path === "/channels/{id}");
}

function mockGetChannel() {
    api.mockGet("/channels/{id}", {
        params: {path: {id: channelId}},
        data: {
            spaceId,
            channel: {
                id: channelId,
                name: "Announcements",
                description: contentFromText("Updates from the team."),
            },
        },
    });
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
            commentCount: 0,
            channel: {id: channelId, name: "Announcements"},
            contentSnippet: contentFromText("Launch summary."),
            reference: {title: "Launch notes"},
        },
        {
            id: roadmapPostId,
            author: bobAccount,
            createdTime: serializeDateString(new Date("2026-05-14T15:05:00.000Z")),
            createdTimeZone: defaultTimeZone,
            commentCount: 0,
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
            commentCount: 0,
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

    api.mockGet("/channels/{id}/posts", {
        params: {
            path: {id: channelId},
            query: {
                limit: agentWebChannelPageApiPostsBatchCount,
                cursor,
            },
        },
        data: {
            spaceId,
            channel: {
                id: channelId,
                name: "Announcements",
            },
            nextCursor: nextPost ? returnedPosts[returnedPosts.length - 1]!.createdTime : null,
            posts: returnedPosts,
        },
    });
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

test("updates the channel name", async () => {
    await readHeadChannelPage();
    mockPatchChannel({name: "Product Updates"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [{old: "# Announcements", new: "# Product Updates", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getChannelPatchRequests()).toMatchObject([
        {
            body: {
                patches: [{type: "SetName", name: "Product Updates"}],
            },
        },
    ]);
});

test("updates the channel description", async () => {
    await readHeadChannelPage();
    mockPatchChannel({
        description: contentFromText("Updates from the product team."),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: "Updates from the team.",
                    new: "Updates from the product team.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getChannelPatchRequests()).toMatchObject([
        {
            body: {
                patches: [
                    {
                        type: "SetDescription",
                        description: contentWithoutKeysFromText("Updates from the product team."),
                    },
                ],
            },
        },
    ]);
});

test("updates the channel name and description together", async () => {
    await readHeadChannelPage();
    mockPatchChannel({
        name: "Product Updates",
        description: contentFromText("Updates from the product team."),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: `\
# Announcements

Updates from the team.`,
                    new: `\
# Product Updates

Updates from the product team.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getChannelPatchRequests()).toMatchObject([
        {
            body: {
                patches: [
                    {type: "SetName", name: "Product Updates"},
                    {
                        type: "SetDescription",
                        description: contentWithoutKeysFromText("Updates from the product team."),
                    },
                ],
            },
        },
    ]);
});

test("rejects converting a head channel page into a tail channel page", async () => {
    const response = await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: response,
                    new: `\
Posts in Announcements.

End of posts.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description. Try again with a channel name as a markdown h1 (e.g. `# My Channel`) on line 1 of the channel markdown.",
    );
});

test("rejects pagination link edits", async () => {
    const response = await readHeadChannelPage({totalPostCount: 16, limit: "720b"});
    const paginationLink = response.match(/\[Next page »\]\([^)]+\)/)?.[0];
    assert(paginationLink);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: paginationLink,
                    new: "[Next page »](/channel/announcements?after=2026-05-14T16:10)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. You can\u2019t update the next page link in channel markdown. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects adding posts", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
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
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can\u2019t add `<post>`s with the `update` tool on a channel page. Call the `create` tool with `type` of `post` with each post you want to create.",
    );
});

test("rejects removing posts", async () => {
    const response = await readHeadChannelPage();
    const firstPostMatch = response.match(
        /<post from="\[Alice\]\(\/human\/alice\)" time="May 14th at 11:00am EDT" comments="0">[\s\S]*?<\/post>\n\n/,
    );
    assert(firstPostMatch);
    const firstPost = firstPostMatch[0];

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [{old: firstPost, new: "", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. You can\u2019t remove `<post>`s. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects changing a post see more link", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: "[See more »](/post/launch-notes)",
                    new: "[See more »](/post/roadmap)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time`/`comments` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects removing a post see more link", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: "\n\n[See more »](/post/launch-notes)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time`/`comments` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects changing a post time attribute", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: 'time="May 14th at 11:00am EDT"',
                    new: 'time="May 14th at 11:01am EDT"',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time`/`comments` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects changing a post comments attribute", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: '<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">',
                    new: '<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="1">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time`/`comments` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects changing a post from attribute", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: 'from="[Alice](/human/alice)"',
                    new: 'from="[Bob](/human/bob)"',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. Any metadata on `<post>`s (the `from`/`time`/`comments` attributes or \u201CSee more\u201D link) must be left unchanged. Try again with a more specific update that only changes the channel name or description.",
    );
});

test("rejects changing a post content snippet", async () => {
    await readHeadChannelPage();

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [{old: "Launch summary.", new: "Updated launch summary.", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "You can only update the channel name and description on a channel page. You can\u2019t change a `<post>`\u2019s content. To update a post, call the `read` tool with the post\u2019s \u201CSee more\u201D link and then call the `update` tool on the post page.",
    );
});

test("rejects adding an end of posts marker to a non-final page", async () => {
    const response = await readHeadChannelPage({totalPostCount: 16, limit: "720b"});
    const postMatches = [...response.matchAll(/<post[\s\S]*?<\/post>/g)];
    const lastPost = postMatches[postMatches.length - 1]?.[0];
    assert(lastPost);

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/channel/announcements",
            updates: [
                {
                    old: lastPost,
                    new: `\
${lastPost}

End of posts.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/channel/announcements`. " +
            "Can\u2019t add the \u201cEnd of posts\u201d marker in an update. Only a `read` tool call can tell you whether you\u2019ve seen all of a channel\u2019s posts. Try again without adding the \u201cEnd of posts\u201d marker.",
    );
});

test("rejects changing the tail page preamble", async () => {
    const cursor = serializeDateString(new Date("2026-05-14T15:00:00.000Z"));
    mockGetChannelPosts({cursor, totalPostCount: 2});

    await callAgentWebReadTool(context, {
        path: `/channel/announcements?after=${cursor}`,
        limit: "10kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: `/channel/announcements?after=${cursor}`,
            updates: [
                {
                    old: "Posts in Announcements.",
                    new: "Posts in Product Updates.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${`/channel/announcements?after=${cursor}`}\`. ` +
            "You can only update the channel name on the first page of the channel. You must leave the `Posts in My Channel.` line at the start of the channel markdown in place. Try calling the `read` tool to navigate to the first page in the channel and you can call the `update` tool on that page to update the channel name.",
    );
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

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
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
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            "You can only update the channel name on the first page of the channel. You must leave the `Posts in My Channel.` line at the start of the channel markdown in place. Try calling the `read` tool to navigate to the first page in the channel and you can call the `update` tool on that page to update the channel name.",
    );
});
