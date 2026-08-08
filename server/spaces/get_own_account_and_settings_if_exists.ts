import {dangerouslyGetAccountAndSettingsIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {SpaceAccountAvatarOverrideItemContextCache} from "~/server/spaces/internal/get_account_if_exists_without_authorization.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {AccountSettings} from "~/shared/accounts/accounts_settings.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError, InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";

export async function getOwnAccountAndSettingsIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SessionActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{account: AccountModel; settings: AccountSettings} | null> {
    const [, accountAndSettings, spaceAccountItem] = await runAllPromises([
        authorizeOwnSpaceAccountAccess(context, accountId),

        // Optimization: Start loading the account even before authorization completes.
        dangerouslyGetAccountAndSettingsIfExistsWithoutAuthorization(context, accountId, {
            consistency,
        }),
        getSpaceAccountItemIfExists(context, spaceId, accountId, {
            consistency,
        }),
    ]);

    if (!spaceAccountItem) return null;

    // Can only access your account in `Active` and `InvitePending` states.
    if (spaceAccountItem.state.type === "Removed") {
        throw createAuthorizeSpaceAccessPermissionDeniedError(
            spaceId,
            context.actor.getPossiblyBotAccountId(),
        );
    }

    // Sanity check: session actors can't be bots. This should be enforced throughout
    // the system but we have a sanity check here just in case we slipped up somewhere.
    //
    // This isn't important for correctness! You could remove this check and there
    // would be no new bugs. This is purely a backup validation check given when
    // creating the session actor we only check whether a session item exists in
    // DynamoDB (we don't load the account and check that it's non-bot at that point).
    if (context.actor.type === "Session" && spaceAccountItem.botId) {
        throw new InternalError("Session actors can\u2019t be bot accounts");
    }

    if (spaceAccountItem.state.type !== "Active") {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in our
        // account table.
        if (!accountAndSettings) {
            throw new DataLossError("Space account item exists but account item doesn\u2019t");
        }

        // NOTE(ifitzsimmons, #account-override-avatar-consistency): "We know there's a
        // potential eventual consistency race condition here where Space#Account has a
        // non-Active state but we don't find a Space#AccountAvatarOverride item due to
        // eventual consistency lag. We're not fixing this since we expect it to be quite
        // rare in practice and the impact to be a pretty minor glitch (removed account
        // appears as if they didn't have an avatar set).
        const spaceAccountAvatarOverride = await SpaceAccountAvatarOverrideItemContextCache.get(
            context,
            consistency,
            `${spaceId}:${accountId}`,
            consistency =>
                SpacesTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Space",
                        sortRangeType: "AccountAvatarOverride",
                        spaceId,
                        accountId,
                    },
                    {consistency},
                ),
        );

        return {
            account: createAccountModelFromItem(
                {
                    ...spaceAccountItem,
                    accountAvatarOverride: spaceAccountAvatarOverride ?? null,
                },
                null,
            ),
            settings: accountAndSettings.settings,
        };
    } else {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in our
        // account table.
        if (!accountAndSettings) {
            throw new DataLossError("Space account item exists but account item doesn\u2019t");
        }

        return {
            account: createAccountModelFromItem(
                {
                    ...spaceAccountItem,
                    // Active accounts should not have an avatar override
                    accountAvatarOverride: null,
                },
                accountAndSettings.account,
            ),
            settings: accountAndSettings.settings,
        };
    }
}
