import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {
    authorizeOwnSpaceAccountAccess,
    authorizeSpaceAccess,
    getOurAccountSpaceIds,
} from "~/server/spaces/spaces_actions.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    TimeZone,
    assertTimeZone,
    defaultTimeZone,
    isTimeZone,
} from "~/shared/helpers/intl/time_zone.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

function getInitialAccountSettingsItem(accountId: AccountId): AccountSettingsItem {
    return {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
        observedTimeZone: defaultTimeZone,
    };
}

/**
 * Get the last opened `SpaceId` for the current session actor.
 */
export async function getOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
): Promise<SpaceId | null | undefined> {
    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: context.actor.getAccountId(),
    });

    const {spaceIds} = await getOurAccountSpaceIds(context);

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
    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
    });

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

    const accountSettingsItem = await AccountsTable.getItemIfExists(authorizedContext, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: authorizedContext.actor.getAccountId(),
    });

    if (accountSettingsItem?.observedTimeZone === timeZone) {
        return;
    }

    await AccountsTable.updateItem(
        authorizedContext,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: authorizedContext.actor.getAccountId(),
        },
        item => {
            return {
                ...item,
                observedTimeZone: timeZone,
            };
        },
        {
            initialItem:
                accountSettingsItem ??
                getInitialAccountSettingsItem(authorizedContext.actor.getAccountId()),
        },
    );

    // This ensures notifications related to the inbox are in the correct time zone.
    await authorizedContext.notificationsInjection.notifyInboxOfTimeZoneChange(timeZone);
}
