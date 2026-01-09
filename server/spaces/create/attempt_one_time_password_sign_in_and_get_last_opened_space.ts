import {
    AttemptOneTimePasswordSignInOptions,
    attemptOneTimePasswordSignInWithAction,
} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {dangerouslyGetAccountLastOpenedSpaceIdWithoutAuthorization} from "~/server/accounts/dangerously_get_account_last_opened_space_id_without_authorization.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

export async function attemptOneTimePasswordSignInAndGetLastOpenedSpace(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    emailAddress: EmailAddress,
    oneTimePassword: string,
    options: AttemptOneTimePasswordSignInOptions,
): Promise<{
    sessionId: SessionId;
    sessionAccountId: AccountId;
    openSpaceId: SpaceId | null;
}> {
    const [{openSpaceId}, {sessionId, sessionAccountId}] =
        await attemptOneTimePasswordSignInWithAction(
            context,
            emailAddress,
            oneTimePassword,
            options,
            async ({accountId}) => {
                const [lastOpenedSpaceId, accountSpacesItem] = await runAllPromises([
                    dangerouslyGetAccountLastOpenedSpaceIdWithoutAuthorization(context, accountId),
                    SpacesTable.getItemIfExists(context, {
                        partitionType: "Account",
                        sortRangeType: "Spaces",
                        accountId,
                    }),
                ]);

                const spaceIds = accountSpacesItem?.spaceIds ?? emptySet;

                if (!lastOpenedSpaceId || !spaceIds.has(lastOpenedSpaceId)) {
                    return {openSpaceId: spaceIds.values().next().value ?? null};
                }

                return {openSpaceId: lastOpenedSpaceId};
            },
        );

    return {
        sessionId,
        sessionAccountId,
        openSpaceId,
    };
}
