import {BotItem, BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {BotId} from "~/shared/id/types/id_types.js";

/**
 * Allow loading the full bot item in tests.
 */
export async function getBotItemForTest(context: DynamoContext, botId: BotId): Promise<BotItem> {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const botItem = await BotsTable.getItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
    });

    return botItem;
}
