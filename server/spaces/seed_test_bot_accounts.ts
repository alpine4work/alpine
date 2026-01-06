import {createAccountTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";

export async function seedTestBotAccounts(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, chatGptBotId, chatGptBotAccountIdForDefaultSpace} =
        getDynamoSeedConstants();

    const currentTime = new Date();

    try {
        // TODO(calebmer): It's pretty annoying that this is duplicated from
        // `instantiateBotSpaceAccount()`. I'd like to get rid of all the data seeding
        // code once we have a proper onboarding flow for the product and run that
        // process instead.
        await DynamoTableSchema.executeTransaction(context, [
            ...createAccountTransactionEntries({
                id: chatGptBotAccountIdForDefaultSpace,
                currentTime,
                name: "ChatGPT",
                dangerouslyInstantiateBot: {
                    botId: chatGptBotId,
                    spaceId: defaultSpaceId,
                },
            }),
            SpacesTable.transactionCreateItem({
                partitionType: "Bot",
                sortRangeType: "Space",
                botId: chatGptBotId,
                spaceId: defaultSpaceId,
                accountId: chatGptBotAccountIdForDefaultSpace,
            }),
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: defaultSpaceId,
                accountId: chatGptBotAccountIdForDefaultSpace,
                role: "Member",
                addedTime: currentTime,
                state: {type: "Active"},
                botId: chatGptBotId,
            }),
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId: chatGptBotAccountIdForDefaultSpace,
                spaceIds: new Set([defaultSpaceId]),
                invitePendingSpaceIds: new Set(),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: defaultSpaceId,
            update: {
                type: "Account",
                accountId: chatGptBotAccountIdForDefaultSpace,
                updatedTraits: {type: "Some", traits: []},
            },
        });
    } catch (error) {
        // If the data already exists in the database, return without error.
        if (isDynamoConditionCheckError(error)) return;

        throw error;
    }
}
