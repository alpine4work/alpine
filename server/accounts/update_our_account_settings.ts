import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    AccountSettingsAction,
    applyAccountSettingsAction,
} from "~/shared/accounts/accounts_settings.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

/**
 * Updates the session actor's settings.
 */
export async function updateOurAccountSettings(
    context: ServerSessionActionContext,
    action: AccountSettingsAction | ReadonlyArray<AccountSettingsAction>,
): Promise<void> {
    const actions = isReadonlyArray(action) ? action : [action];
    if (actions.length === 0) return;

    const actionTypes = Array.from(new Set(mapIterable(actions, action => action.type))).sort(
        defaultCompareStrings,
    );

    // Create a span for each update action we're making. The spans will all take the
    // same duration. This doesn't quite accurately map to the actual execution model
    // (all updates are made at the same time) but eh close enough. It's easier from a
    // data analysis perspective if we're not merging the actions into one span.
    const spans = actionTypes.map(actionType => {
        const {span, finishSpan} = context.tracer.startSpan(
            `Updating account settings ${actionType}`,
        );
        span.addData({context: {accountId: context.actor.getAccountId()}});
        return {span, finishSpan};
    });

    try {
        await context.with({tracer: new TracerContextModule(spans[0]!.span)}, async context => {
            let oldAccountSettingsItem: AccountSettingsItem | undefined;

            const newAccountSettingsItem = await AccountsTable.updateItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "Settings",
                    accountId: context.actor.getAccountId(),
                },
                item => {
                    item ??= getInitialAccountSettingsItem(context.actor.getAccountId());
                    oldAccountSettingsItem = item;

                    const newItem = actions.reduce(applyAccountSettingsAction, item);
                    if (newItem === item) return item;

                    return {
                        ...newItem,
                        partitionType: "Account",
                        sortRangeType: "Settings",
                        accountId: context.actor.getAccountId(),
                        updateLockVersion: item.updateLockVersion,
                    };
                },
            );

            assert(oldAccountSettingsItem);
            assert(newAccountSettingsItem);

            if (
                newAccountSettingsItem.observedTimeZone !== null &&
                oldAccountSettingsItem.observedTimeZone !== newAccountSettingsItem.observedTimeZone
            ) {
                // This ensures notifications related to the inbox are in the correct time zone.
                await context.notificationsInjection.notifyInboxOfTimeZoneChange(
                    newAccountSettingsItem.observedTimeZone,
                );
            }
        });

        for (const {finishSpan} of spans) {
            finishSpan();
        }
    } catch (error) {
        for (const {span, finishSpan} of spans) {
            span.addException(error);
            finishSpan();
        }
        throw error;
    }
}
