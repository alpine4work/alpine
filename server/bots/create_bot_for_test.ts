import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {BotId} from "~/shared/id/types/id_types.js";

export async function createBotForTest(
    context: DynamoContext,
    {name, webhookUrl}: {name: string; webhookUrl: string},
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const botId = generateId<BotId>();

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
        createdTime: new Date(),
        name,
        webhookUrl,
    });

    return {id: botId};
}
