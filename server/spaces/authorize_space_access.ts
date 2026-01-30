import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorBase, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Authorize that the authenticated account has access to the provided
 * `spaceId`. Throws if the account does not have access.
 *
 * This function is mostly strongly consistent so it's safe to call in a
 * strongly consistent environment. See the documentation on
 * `isAccountMemberOfSpace()` for details about consistency guarantees.
 *
 * This function also checks the role of actor account in the current
 * space(`spaceId`) using optional property`expectedRole`.
 */
export async function authorizeSpaceAccess(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    expectedRole?: SpaceRole,
    options?: {allowInvitePending?: boolean},
): Promise<void> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== spaceId
            ) {
                throw new PermissionDeniedError(
                    "Impersonated account actor doesn\u2019t have access to space",
                    {aggregateDedupeKey: spaceId},
                );
            }

            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getPossiblyBotAccountId(),
                    expectedRole,
                    options,
                ))
            ) {
                throw createAuthorizeSpaceAccessPermissionDeniedError(
                    spaceId,
                    context.actor.getPossiblyBotAccountId(),
                    expectedRole,
                );
            }
            break;
        }
        case "System": {
            if (context.actor.getSpaceId() !== spaceId) {
                throw new PermissionDeniedError("System actor doesn\u2019t have access to space", {
                    aggregateDedupeKey: spaceId,
                });
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Same as `authorizeSpaceAccess()` but instead of throwing an error when the
 * account doesn't have space access, we return a `Result` with the error. So
 * the caller can handle permission denied errors without throwing.
 *
 * The logic should be the exact same between this function and
 * `authorizeSpaceAccess()`.
 */
export async function authorizeSpaceAccessIfPossible(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    expectedRole?: SpaceRole,
    options?: {allowInvitePending?: boolean},
): Promise<Result<void, ErrorBase>> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            const accountId = context.actor.getPossiblyBotAccountId();

            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== spaceId
            ) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= new PermissionDeniedError(
                            "Impersonated account actor doesn\u2019t have access to space",
                            {aggregateDedupeKey: spaceId},
                        );
                        return error;
                    },
                };
            }

            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    accountId,
                    expectedRole,
                    options,
                ))
            ) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= createAuthorizeSpaceAccessPermissionDeniedError(
                            spaceId,
                            accountId,
                        );
                        return error;
                    },
                };
            }
            return okResult;
        }
        case "System": {
            if (context.actor.getSpaceId() !== spaceId) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= new PermissionDeniedError(
                            "System actor doesn\u2019t have access to space",
                            {aggregateDedupeKey: spaceId},
                        );
                        return error;
                    },
                };
            }
            return okResult;
        }
        case "Anonymous": {
            let error: ErrorBase | undefined;

            return {
                ok: false,
                get error() {
                    // When this function is called, frequently we only check `ok`. So lazily
                    // create an error only when needed.
                    error ??= unauthenticatedSessionError();
                    return error;
                },
            };
        }
        default:
            throw exhaustive(context.actor);
    }
}
