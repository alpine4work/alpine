import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoItem, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {
    AccountSettingsAction,
    applyAccountSettingsAction,
} from "~/shared/accounts/accounts_settings.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {RpcCallId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Updates the session actor's settings.
 */
export async function updateOurAccountSettings(
    context: ServerSessionActionContext,
    action: AccountSettingsAction | ReadonlyArray<AccountSettingsAction>,
    {clientRequestToken}: {clientRequestToken?: RpcCallId} = {},
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
            let oldAccountSettingsItem = await AccountsTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId: context.actor.getAccountId(),
            });
            oldAccountSettingsItem ??= getInitialAccountSettingsItem(context.actor.getAccountId());

            const newItem = actions.reduce(applyAccountSettingsAction, oldAccountSettingsItem);
            if (newItem === oldAccountSettingsItem) return oldAccountSettingsItem;

            let newAccountSettingsItem: AccountSettingsItem;

            if (!clientRequestToken) {
                newAccountSettingsItem = await AccountsTable.directlyUpdateItem(context, {
                    ...newItem,
                    partitionType: "Account",
                    sortRangeType: "Settings",
                    accountId: context.actor.getAccountId(),
                });
            } else {
                // We drop down to an explicit transaction (rather than the simpler
                // `AccountsTable.updateItem` helper) so we can pass a `clientRequestToken`. That
                // token is what enforces at-most-once semantics for `UpdateReactionAffinity`,
                // which is non-idempotent at the reducer level (each call adds +1 point).
                const transaction = AccountsTable.transactionDirectlyUpdateItem(
                    DynamoItem.create({
                        ...newItem,
                        partitionType: "Account",
                        sortRangeType: "Settings",
                        accountId: context.actor.getAccountId(),
                        updateLockVersion: oldAccountSettingsItem.updateLockVersion,
                    }),
                );

                await DynamoTableSchema.executeTransaction(context, [transaction], {
                    clientRequestToken,
                });

                newAccountSettingsItem = transaction.newItem;
            }

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
    } catch (error) {
        // If the error is an idempotent parameter mismatch error, it means that we've
        // already processed the request successfully. We should simply noop and return.
        if (isDynamoIdempotentParameterMismatchError(error)) return;

        for (const {span} of spans) {
            span.addException(error);
        }
        throw error;
    } finally {
        for (const {finishSpan} of spans) {
            finishSpan();
        }
    }
}
