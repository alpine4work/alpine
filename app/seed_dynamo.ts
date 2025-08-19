import {seedTestAccounts} from "~/server/accounts/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {seedTestChannels} from "~/server/forum/data/forum_table.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {dangerouslyFavoriteSearchEntityWithoutAuthorization} from "~/server/search/data/table/search_entity_table.js";
import {seedTestSpaces} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Seed DynamoDB with some data in development and test environments.
 *
 * This seed function is idempotent. You may run it however many times you want
 * and it will keep working.
 */
export function seedDynamo(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
): Promise<void> {
    assert(process.env.NODE_ENV !== "production");

    return context.tracer.withSpan("Seed DynamoDB test data", async context => {
        // Make sure accounts exist since everything that follows depends
        // on accounts:
        await seedTestAccounts(context);

        // Make sure spaces exist since everything that follows depends on
        // the spaces:
        await seedTestSpaces(context, {
            favoriteSearchEntity: dangerouslyFavoriteSearchEntityWithoutAuthorization,
        });

        await seedTestChannels(context);
    });
}
