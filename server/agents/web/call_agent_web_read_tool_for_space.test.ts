import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
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

function createSpaceAccountMock({
    name,
    state = "Active",
    botId,
}: {
    name: string;
    state?: "Active" | "InvitePending" | "Removed";
    botId?: BotId;
}): ApiAccountResponse {
    const account = createApiAccountMock({name, botId});
    return {
        ...account,
        space: {
            ...account.space,
            inactive:
                state === "Active"
                    ? undefined
                    : state === "InvitePending"
                      ? {type: "InvitePending"}
                      : {type: "Removed"},
        },
    };
}

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_space.test.ts");
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

test("reads active and invited human members in API order", async () => {
    api.mockGet("/spaces/{id}/accounts", {
        params: {path: {id: spaceId}},
        data: {
            space: {id: spaceId, name: "Product Lab"},
            accounts: [
                createSpaceAccountMock({name: "Anthony Mose"}),
                createSpaceAccountMock({
                    name: "Helper Bot",
                    botId: generateId<BotId>(),
                }),
                createSpaceAccountMock({name: "Alice Smith"}),
                createSpaceAccountMock({name: "Charlie Invited", state: "InvitePending"}),
                createSpaceAccountMock({name: "Zoe Removed", state: "Removed"}),
            ],
        },
    });

    expect(await callAgentWebReadTool(context, {path: "/space", limit: "10kb"})).toEqual(`\
# Product Lab

## Members

- [Anthony Mose](/human/anthony-mose)
- [Alice Smith](/human/alice-smith)
- [Charlie Invited](/human/charlie-invited)`);
});

test("reads a member link discovered on the space page", async () => {
    const alice = createSpaceAccountMock({name: "Alice Smith"});

    api.mockGet("/spaces/{id}/accounts", {
        params: {path: {id: spaceId}},
        data: {space: {id: spaceId, name: "Product Lab"}, accounts: [alice]},
    });
    api.mockGet("/spaces/{id}/accounts/{accountId}", {
        params: {path: {id: spaceId, accountId: alice.id}},
        data: {account: alice},
    });

    expect(await callAgentWebReadTool(context, {path: "/space", limit: "10kb"})).toEqual(`\
# Product Lab

## Members

- [Alice Smith](/human/alice-smith)`);

    expect(await callAgentWebReadTool(context, {path: "/human/alice-smith", limit: "10kb"}))
        .toEqual(`\
# Alice Smith

- Role: Member
- Short name: Alice`);
});

test("prints an empty members section when the space has no human members", async () => {
    api.mockGet("/spaces/{id}/accounts", {
        params: {path: {id: spaceId}},
        data: {
            space: {id: spaceId, name: "Automation Lab"},
            accounts: [
                createSpaceAccountMock({name: "Former Member", state: "Removed"}),
                createSpaceAccountMock({
                    name: "Helper Bot",
                    botId: generateId<BotId>(),
                }),
            ],
        },
    });

    expect(await callAgentWebReadTool(context, {path: "/space", limit: "10kb"})).toEqual(`\
# Automation Lab

## Members`);
});

test("requests the ambient space and its account collection", async () => {
    api.mockGet("/spaces/{id}/accounts", {
        params: {path: {id: spaceId}},
        data: {space: {id: spaceId, name: "Product Lab"}, accounts: []},
    });

    await callAgentWebReadTool(context, {path: "/space", limit: "10kb"});

    expect(api.getRequestHistory()).toEqual([
        {
            method: "GET",
            path: "/spaces/{id}/accounts",
            params: {path: {id: spaceId}},
            tracer: expect.anything(),
        },
    ]);
});

test("does not route paths nested beneath space", async () => {
    expect(await callAgentWebReadTool(context, {path: "/space/members", limit: "10kb"})).toEqual(
        "Error: Couldn\u2019t read `/space/members`. Nothing found for path `/space/members`. You may " +
            "only read paths you\u2019ve already seen a link for. Please try calling the `read` tool " +
            "again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t " +
            "have a link for then don\u2019t try making up a path. Instead try calling the `search` tool " +
            "which will help you find what you need and will give you links which you can use with " +
            "the `read` tool.",
    );
});
