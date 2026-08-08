import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {
    InboxExpectedAccessLevel,
    inboxPermissionDeniedErrorDisplayMessageByAccessLevel,
} from "~/server/notifications/data/inbox_error_messages.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {EffectiveAccessPolicy} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Returns the effective access policy for an inbox partition owned by `accountId`.
 *
 * The inbox is modeled like other private entities: only the owning account has an
 * account grant. There is no `defaultGrant` or `urlGrant`, so bots must pass the
 * usual `evaluateAccessPolicy()` intersection against `getBotAccessPolicy()` in
 * order to read this inbox. Bots scoped to entities with `urlGrant` or
 * `defaultGrant` cannot read an inbox (`evaluateAccessPolicy()` rejects that
 * combination). This effectively means bots can only read inboxes in narrow scopes
 * (for example a private DM) where only the inbox owner appears in the scoped
 * policy.
 *
 * System actors are granted access via `evaluateAccessPolicy()` because the inbox
 * is an entity in the space and system actors have access to everything in their
 * space.
 */
export function getEffectiveAccessPolicyForInboxOfAccount(
    accountId: AccountId,
): EffectiveAccessPolicy {
    return {
        accountGrantById: new Map([[accountId, {level: "Manage"}]]),
        defaultGrant: null,
        urlGrant: null,
    };
}

export async function authorizeInboxAccessForAccountIfPossible(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        expectedAccessLevel,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        expectedAccessLevel: InboxExpectedAccessLevel;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; accountId: AccountId}, ErrorBase>> {
    const inboxPolicy = getEffectiveAccessPolicyForInboxOfAccount(accountId);

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount":
        case "Bot":
        case "System": {
            const spaceResult = await authorizeSpaceAccessIfPossible(context, spaceId);
            if (!spaceResult.ok) {
                return {ok: false, error: spaceResult.error};
            }

            const allowed = await evaluateAccessPolicy(
                context,
                spaceId,
                inboxPolicy,
                expectedAccessLevel,
                options,
            );
            if (!allowed) {
                return {
                    ok: false,
                    error: await createAccessPolicyPermissionDeniedError(context, {
                        spaceId,
                        expectedAccessLevel,
                        aggregateDedupeKey: `${spaceId}:${accountId}`,
                        displayMessages: inboxPermissionDeniedErrorDisplayMessageByAccessLevel,
                    }),
                };
            }

            return {ok: true, value: {spaceId, accountId}};
        }
        case "Anonymous":
            return {ok: false, error: unauthenticatedSessionError()};
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Authorize that the current actor may read the inbox for `accountId` in
 * `spaceId`.
 *
 * Session and ImpersonatedAccount actors can read their own inboxes, bots can read
 * inboxes according to their access policy, system actors can read any inbox in
 * their space,and anonymous actors cannot read inboxes at all.
 */
export async function authorizeInboxAccessForAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        expectedAccessLevel,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        expectedAccessLevel: InboxExpectedAccessLevel;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; accountId: AccountId}> {
    return unwrapResult(
        await authorizeInboxAccessForAccountIfPossible(
            context,
            {spaceId, accountId, expectedAccessLevel},
            options,
        ),
    );
}
