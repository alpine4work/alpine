import {ProcessContext} from "~/server/context/context";
import {seedTestAccounts} from "~/server/dynamo/accounts_table";
import {seedTestAlphaConfiguration} from "~/server/dynamo/alpha_access_table";
import {seedTestSpaces} from "~/server/dynamo/spaces_table";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Seed DynamoDB with some data in development and test environments.
 *
 * This seed function is idempotent. You may run it however many times you want
 * and it will keep working.
 */
export async function seedDynamo(context: ProcessContext) {
    assert(process.env.NODE_ENV !== "production");

    await runAllPromises([
        seedTestAlphaConfiguration(context),
        seedTestAccounts(context),
        seedTestSpaces(context),
    ]);
}
