import {seedTestAccounts} from "~/server/accounts/accounts_table.js";
import {seedTestAlphaConfiguration} from "~/server/alpha/alpha_access_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {seedTestChannels} from "~/server/forum/data/forum_table.js";
import {seedTestSpaces} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Seed DynamoDB with some data in development and test environments.
 *
 * This seed function is idempotent. You may run it however many times you want
 * and it will keep working.
 */
export function seedDynamo(context: DynamoContext): Promise<void> {
    assert(process.env.NODE_ENV !== "production");
    return context.tracer.withSpan("Seed DynamoDB test data", async context => {
        await runAllPromises([
            seedTestAlphaConfiguration(context),
            seedTestAccounts(context),
            seedTestSpaces(context),
            seedTestChannels(context),
        ]);
    });
}
