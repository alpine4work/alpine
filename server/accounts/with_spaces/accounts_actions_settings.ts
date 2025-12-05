import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeOwnSpaceAccountAccess,
    authorizeSpaceAccess,
    getOurAccountSpaceIds,
} from "~/server/spaces/spaces_actions.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    TimeZone,
    assertTimeZone,
    defaultTimeZone,
    isTimeZone,
} from "~/shared/helpers/intl/time_zone.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

const AccountSettingsItemContextCache = new DynamoContextCache<
    AccountId,
    AccountSettingsItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

function getInitialAccountSettingsItem(accountId: AccountId): AccountSettingsItem {
    return {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
        observedTimeZone: defaultTimeZone,
    };
}

async function getAccountSettingsItemIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountSettingsItem | null> {
    // Pretend like the unknown account doesn't exist. We do have an unknown
    // account record in our database as a safety precaution to make sure we
    // don't accidentally create an account with the unknown `AccountId`. But we
    // should never return that data. Instead if you want data for an unknown
    // account call `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not
    // found error.
    if (accountId === unknownAccountId) return null;

    return AccountSettingsItemContextCache.get(
        context,
        consistency,
        accountId,
        async consistency => {
            const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId,
                consistency,
            });
            return accountSettingsItem;
        },
    );
}

/**
 * Get the last opened `SpaceId` for the current session actor.
 */
export async function getOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
): Promise<SpaceId | null | undefined> {
    const [accountSettingsItem, {spaceIds}] = await runAllPromises([
        getAccountSettingsItemIfExists(context, context.actor.getAccountId()),
        getOurAccountSpaceIds(context),
    ]);

    if (
        !accountSettingsItem?.lastOpenedSpaceId ||
        !spaceIds.has(accountSettingsItem.lastOpenedSpaceId)
    ) {
        return spaceIds.size > 0 ? spaceIds.values().next().value : null;
    }

    return accountSettingsItem.lastOpenedSpaceId;
}

/**
 * Updates our last opened `SpaceId`.
 */
export async function updateOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= getInitialAccountSettingsItem(context.actor.getAccountId());
            if (item.lastOpenedSpaceId === spaceId) return item;
            return {
                ...item,
                lastOpenedSpaceId: spaceId,
            };
        },
    );
}

/**
 * Get the observed time zone for the provided account.
 * System actors are allowed to get the time zone for any account in their space, but session actors
 * and bots are only allowed to get the time zone for their own account.
 */
export async function getAccountTimeZoneIfExists(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<TimeZone | null> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const accountSettingsItem = await getAccountSettingsItemIfExists(context, accountId);

    return accountSettingsItem?.observedTimeZone
        ? assertTimeZone(accountSettingsItem.observedTimeZone)
        : null;
}

/**
 * Updates the session actor's time zone.
 * Time zone is set at the account level and is not tied to a specific space.
 * Only session actors are allowed to update their own time zone.
 */
export async function updateOurAccountObservedTimeZone(
    context: ServerSessionActionContext,
    timeZone: TimeZone,
): Promise<void> {
    const authorizedContext = context.actor.authorizeSession();

    if (!isTimeZone(timeZone)) {
        throw new InvalidArgumentError(quote`Received invalid time zone: \`${timeZone}\``);
    }

    const newAccountSettingsItem = await AccountsTable.updateItem(
        authorizedContext,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: authorizedContext.actor.getAccountId(),
        },
        item => {
            item ??= getInitialAccountSettingsItem(authorizedContext.actor.getAccountId());
            if (item.observedTimeZone === timeZone) return item;
            return {
                ...item,
                observedTimeZone: timeZone,
            };
        },
    );

    if (newAccountSettingsItem?.observedTimeZone !== timeZone) {
        // This ensures notifications related to the inbox are in the correct time zone.
        await authorizedContext.notificationsInjection.notifyInboxOfTimeZoneChange(timeZone);
    }
}
