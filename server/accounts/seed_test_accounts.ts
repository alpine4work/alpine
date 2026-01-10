import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";

export async function seedTestAccounts(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {adminAccountId, adminEmailAddress} = getDynamoSeedConstants();

    await AccountsTable.createItemIfNoneExists(context, {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: adminAccountId,
        name: "Test Admin",
        nameVersion: 0,
        createdTime: new Date(),
        hasInternalAccess: true,
        observedTimeZone: defaultTimeZone,
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(adminAccountId),
    });

    await AccountsTable.createItemIfNoneExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: adminEmailAddress,
        accountId: adminAccountId,
        isVerified: true,
        createdTime: new Date(),
    });
}
