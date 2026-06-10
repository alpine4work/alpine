import {differenceInMinutes} from "date-fns";
import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getAccount} from "~/shared/rpc/accounts_rpc_definitions.js";

// NOTE(calebmer, 2024-04-12): I added this before `WebSocketServer` performed
// authorization on `sendEventToAll()` and `sendEvent()` calls. So on every
// `/broadcast-inbox-realtime-event-transaction` request I wanted to authorize the
// account still had access to the space. But calling the `getAccount()` RPC every
// `/broadcast-inbox-realtime-event-transaction` request seemed expensive
// (thundering herd problem, a write that updates many account inboxes would cause
// many reads). So I built this cache. Now that `WebSocketServer.sendEventToAll()`
// authorizes all connections before sending events (we re-authorize every 5min or
// so) we could delete this cache and rely on `WebSocketServer` authorization.
export class MyAccountDurableObjectAuthorizer {
    private readonly _systemActorCache = new Map<
        `${SpaceId}:${AccountId}`,
        {cacheTime: Date; promise: Promise<void>}
    >();

    async authorizeMyAccountAccess(context: WorkerActionContext, accountId: AccountId) {
        switch (context.actor.type) {
            case "Session":
            case "ImpersonatedAccount": {
                if (context.actor.getAccountId() !== accountId) {
                    throw new PermissionDeniedError(
                        "Can only access the durable object for your own account",
                    );
                }
                break;
            }
            case "System": {
                const currentTime = new Date();
                const spaceId = context.actor.getSpaceId();
                const cacheKey = `${spaceId}:${accountId}` as const;
                let cacheValue = this._systemActorCache.get(cacheKey);

                // Only call the `getAccount()` RPC every 30min. If we find the account exists in
                // the space once, it is likely to continue to exist in the space for a long time.
                // (If not forever.)
                if (cacheValue && differenceInMinutes(currentTime, cacheValue.cacheTime) < 30) {
                    await cacheValue.promise;
                } else {
                    cacheValue = {
                        cacheTime: currentTime,
                        promise: (async () => {
                            try {
                                await getAccount(context, {spaceId, accountId});
                            } catch (error) {
                                if (error instanceof NotFoundError) {
                                    throw PermissionDeniedError.from(error);
                                }
                                throw error;
                            }
                        })(),
                    };
                    this._systemActorCache.set(cacheKey, cacheValue);
                    await cacheValue.promise;
                }
                break;
            }
            case "Anonymous": {
                throw unauthenticatedSessionError();
            }
            case "Bot": {
                throw permissionDeniedBotError();
            }
            default:
                throw exhaustive(context.actor);
        }
    }
}
