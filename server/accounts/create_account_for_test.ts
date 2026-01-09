import {
    AccountItemWithoutAvatar,
    AccountSettingsItem,
    AccountsTable,
} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {pickRandomReactionCharacterForAccount} from "~/server/accounts/pick_random_reaction_character_for_account.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

/**
 * Create an account but only in test environments.
 */
export async function createAccountForTest(
    context: DynamoContext,
    {
        id = generateId<AccountId>(),
        name,
        hasInternalAccess = false,
        createdTime = new Date(),
        observedTimeZone = null,
        reactionCharacter = pickRandomReactionCharacterForAccount(),
    }: {
        id?: AccountId;
        name: string;
        hasInternalAccess?: boolean;
        createdTime?: Date;
        observedTimeZone?: TimeZone | null;
        reactionCharacter?: ReactionCharacter;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const accountItem: AccountItemWithoutAvatar = {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: id,
        name,
        nameVersion: 0,
        createdTime,
        hasInternalAccess,
        reactionCharacter,
    };

    const accountSettingsItem: AccountSettingsItem = {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: id,
        observedTimeZone,
    };

    if (isDeepEqual(accountSettingsItem, getInitialAccountSettingsItem(id))) {
        await AccountsTable.createItem(context, accountItem);
    } else {
        await DynamoTableSchema.executeTransaction(context, [
            AccountsTable.transactionCreateItem(accountItem),
            AccountsTable.transactionCreateOrReplaceItem(accountSettingsItem),
        ]);
    }

    return {createdTime};
}

/**
 * Create an email address associated with the provided account in a test
 * environment.
 */
export async function createAccountEmailAddressForTest(
    context: DynamoContext,
    {
        accountId,
        emailAddress,
        isEmailAddressVerified,
    }: {
        accountId: AccountId;
        emailAddress: EmailAddress;
        isEmailAddressVerified: boolean;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    // This is a test. We assume the `AccountId` exists and that it's not a bot.

    await AccountsTable.createItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
        accountId,
        isVerified: isEmailAddressVerified,
        createdTime: new Date(),
    });
}

/**
 * Create a session but only in test environments. This is not secure! We must
 * only create sessions if the actual owner of the account is authorizing with
 * our service.
 */
export async function createSessionForTest(
    context: DynamoContext,
    {id = generateId<SessionId>(), accountId}: {id?: SessionId; accountId: AccountId},
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const createdTime = new Date();

    await AccountsTable.createItem(context, {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: id,
        accountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    });

    return {createdTime};
}

/**
 * Get the item representing an email address associated with an account for tests.
 */
export async function getAccountEmailAddressForTest(
    context: DynamoContext,
    emailAddress: EmailAddress,
) {
    assert(process.env.NODE_ENV === "test");

    return AccountsTable.getItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });
}
