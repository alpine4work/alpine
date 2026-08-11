import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool as actuallyCallAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebCreateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebCreateTool>
): Promise<string> {
    return (await actuallyCallAgentWebCreateTool(...callArguments)).response;
}

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_account.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

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

test.each(["account", "human", "bot"])("throws display message when creating `%s`", async type => {
    await expect(
        callAgentWebCreateTool(context, {
            type,
            content: `\
# Alice Smith

- Role: Member`,
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t create. Unrecognized type \`${type}\`. To see everything you can create, call the \`read\` tool with \`/skill/create\`. Try again with a different type.`,
    );
    expect(api.getRequestHistory()).toEqual([]);
});
