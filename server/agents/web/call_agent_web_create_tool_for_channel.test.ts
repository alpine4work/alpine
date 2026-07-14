import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
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
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
});

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

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "channel", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

async function expectUnimplementedCreate(content: string) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "channel", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty(
        "message",
        "Channel create API endpoint hasn\u2019t been implemented yet",
    );
}

test("throws unimplemented when creating a channel with a name and description", async () => {
    await expectUnimplementedCreate(`\
# Announcements

Updates from the team.
`);
});

test("throws unimplemented when creating a channel without a description or divider", async () => {
    await expectUnimplementedCreate(`\
# Announcements
`);
});

test("throws unimplemented when creating a channel with an optional divider", async () => {
    await expectUnimplementedCreate(`\
# Announcements

Updates from the team.

---
`);
});

test("rejects creating a channel from a tail posts page", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Posts in Announcements.

End of posts.
`,
        expected:
            "Channel markdown must start with a title (e.g. `# General`) when creating a channel. Try again with a title.",
    });
});

test("rejects creating a channel with pagination", async () => {
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Channel",
        id: generateId<ChannelId>(),
        title: "Announcements",
    });

    await expectInvalidCreateDisplayMessage({
        content: `\
# Announcements

Updates from the team.

---

[Next page »](/channel/announcements?after=2026-05-14T15:00)
`,
        expected:
            "You can\u2019t include a \u201CNext page »\u201D link when creating a channel. Try again without a \u201CNext page »\u201D link.",
    });
});

test("rejects creating a channel with posts", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Announcements

Updates from the team.

---

<post>

Launch summary.

</post>
`,
        expected:
            "You can\u2019t create `<post>`s while creating a channel. Try creating the channel again without posts and then call the `create` tool with `type` of `post` for each post you want to create.",
    });
});
