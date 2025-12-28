import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

export const updateOurAccountNameBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Updates an account's name. When we update an account's name we also need to
 * update our search index and task index since the account name is present in
 * both indexes.
 */
export async function updateOurAccountName(
    context: ServerSessionActionContext,
    name: string,
    {nameVersionForTest}: {nameVersionForTest?: number} = {},
): Promise<AccountModelWithoutSpace> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    return context.dynamo.retryTransaction(async context => {
        const accountItem = await getAccountItem(context, context.actor.getAccountId());

        // Can only set `nameVersionForTest` in unit tests.
        assert(
            nameVersionForTest === undefined ||
                (import.meta.jest && nameVersionForTest > accountItem.nameVersion),
        );

        const nameVersion = nameVersionForTest ?? accountItem.nameVersion + 1;

        // We commit an update account name task action in all the spaces an account is in.
        const {spaceIds, getConditionCheckTransactionEntry} =
            await context.spacesInjection.getOurAccountSpaceIds();

        const taskTransactionEntries =
            context.tasksInjection.internalGetUpdateOurAccountNameTaskTransactionEntries({
                spaceIds,
                name,
                nameVersion,
            });

        const newAccountItem = {
            ...accountItem,
            name,
            nameVersion,
        };

        const transactionEntries = [
            AccountsTable.transactionDirectlyUpdateItem(newAccountItem),
            ...taskTransactionEntries,
        ];

        // Don't commit if the account's spaces changed without us knowing.
        {
            const transactionEntry = getConditionCheckTransactionEntry();
            if (transactionEntry) transactionEntries.push(transactionEntry);
        }

        await updateOurAccountNameBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        // Reindex the account in all space search indexes where it appears. This may
        // recursively update any search entities where the account is mentioned.
        for (const spaceId of spaceIds) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Account",
                    accountId: newAccountItem.accountId,
                    updatedTraits: {type: "Some", traits: ["WithoutSpace"]},
                },
            });
        }

        return createAccountModelWithoutSpaceFromItem(newAccountItem);
    });
}
