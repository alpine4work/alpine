import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

async function callAgentWebUpdateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebUpdateTool>
): Promise<string> {
    return (await actuallyCallAgentWebUpdateTool(...callArguments)).response;
}

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_space.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: generateId<AccountId>(),
        bot: {id: generateId<BotId>()},
    },
};

beforeEach(async () => {
    await storage.deleteAll();
});

test("rejects updating a space", async () => {
    const alice = createApiAccountMock({name: "Alice Smith"});

    api.mockGet("/spaces/{id}/accounts", {
        params: {path: {id: spaceId}},
        data: {space: {id: spaceId, name: "Product Lab"}, accounts: [alice]},
    });

    expect(await callAgentWebReadTool(context, {path: "/space", limit: "10kb"})).toEqual(`\
# Product Lab

## Members

- [Alice Smith](/human/alice-smith)`);

    expect(
        await callAgentWebUpdateTool(context, {
            path: "/space",
            updates: [{old: "# Product Lab", new: "# Product Studio", replaceAll: false}],
        }),
    ).toEqual(
        "Error: Couldn\u2019t update `/space`. Can\u2019t update spaces using the `update` tool for " +
            "now. Try updating another page instead.",
    );
});

test("requires reading the space before rejecting its update", async () => {
    expect(
        await callAgentWebUpdateTool(context, {
            path: "/space",
            updates: [{old: "# Product Lab", new: "# Product Studio", replaceAll: false}],
        }),
    ).toEqual(
        "Error: Couldn\u2019t update `/space`. Can\u2019t call the `update` tool for a path that hasn\u2019t " +
            "been read recently. Call the `read` tool with the path `/space` then call the `update` " +
            "tool again.",
    );
});
