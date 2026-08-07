import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const {span} = testTracer.startSpan("call_agent_web_create_tool_for_channel.test.ts");
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
    await storeAgentWebPageLinkForTest(storage, context.botAccount);
});

function channelContentFromText(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

const emptyChannelContent: ApiContentResponseWithoutKeys = {
    elements: [{type: "Paragraph", elements: []}],
};

function mockCreateChannel({
    id = generateId<ChannelId>(),
    name,
    description,
}: {
    id?: ChannelId;
    name: string;
    description: ApiContentResponseWithoutKeys;
}): ChannelId {
    api.mockPost("/channels", {
        params: "Any",
        data: {
            spaceId,
            channel: {
                id,
                name,
                description: addKeysToApiContentForTest(description),
            },
        },
    });

    return id;
}

test("calls the channels API with parsed channel content", async () => {
    const description = channelContentFromText("Updates from the team.");
    mockCreateChannel({
        name: "Announcements",
        description,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements

Updates from the team.
`,
        }),
    ).resolves.toEqual(`\
Create was successful. New channel: [Announcements](/channel/announcements).`);

    expect(api.getCallCount("POST", "/channels")).toBe(1);
    expect(api.getRequestHistory()[0]).toMatchObject({
        method: "POST",
        path: "/channels",
        body: {
            spaceId,
            channel: {
                name: "Announcements",
                description,
            },
        },
    });
});

test("creates a channel without a description or divider", async () => {
    mockCreateChannel({
        name: "Announcements",
        description: emptyChannelContent,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements
`,
        }),
    ).resolves.toEqual(`\
Create was successful. New channel: [Announcements](/channel/announcements).`);

    expect(api.getRequestHistory()[0]).toMatchObject({
        body: {
            spaceId,
            channel: {
                name: "Announcements",
                description: emptyChannelContent,
            },
        },
    });
});

test("creates a channel with a description divider and ignores the posts divider", async () => {
    const description: ApiContentResponseWithoutKeys = {
        elements: [
            {type: "Paragraph", elements: [{type: "Text", text: "Before divider"}]},
            {type: "Divider"},
            {type: "Paragraph", elements: [{type: "Text", text: "After divider"}]},
        ],
    };

    mockCreateChannel({
        name: "Announcements",
        description,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements

Before divider

<hr />

After divider

---
`,
        }),
    ).resolves.toEqual(`\
Create was successful. New channel: [Announcements](/channel/announcements).`);

    expect(api.getRequestHistory()[0]).toMatchObject({
        body: {
            spaceId,
            channel: {
                name: "Announcements",
                description,
            },
        },
    });
});

test("creates a channel with a description divider at the end of the description and ignores the posts divider", async () => {
    const description: ApiContentResponseWithoutKeys = {
        elements: [
            {type: "Paragraph", elements: [{type: "Text", text: "Before divider"}]},
            {type: "Divider"},
            {type: "Paragraph", elements: [{type: "Text", text: "After divider"}]},
            {type: "Divider"},
        ],
    };

    mockCreateChannel({
        name: "Announcements",
        description,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements

Before divider

<hr />

After divider

<hr />

---
`,
        }),
    ).resolves.toEqual(`\
Create was successful. New channel: [Announcements](/channel/announcements).`);

    expect(api.getRequestHistory()[0]).toMatchObject({
        body: {
            spaceId,
            channel: {
                name: "Announcements",
                description,
            },
        },
    });
});

test("rejects creating a channel from a tail posts page", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
Posts in Announcements.

End of posts.
`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create channel. " +
            "Channel markdown must start with a title (e.g. `# General`) when creating a channel. Try again with a title.",
    );
});

test("rejects creating a channel with pagination", async () => {
    await storeAgentWebPageLinkForTest(storage, {
        type: "Channel",
        id: generateId<ChannelId>(),
        title: "Announcements",
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:00)
`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create channel. " +
            "You can\u2019t include a \u201CNext page »\u201D link when creating a channel. Try again without a \u201CNext page »\u201D link.",
    );
});

test("rejects creating a channel with posts", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "channel",
            content: `\
# Announcements

Updates from the team.

---

<post>

Launch summary.

</post>
`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create channel. " +
            "You can\u2019t create `<post>`s while creating a channel. Try creating the channel again without posts and then call the `create` tool with `type` of `post` for each post you want to create.",
    );
});
