import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * A limited subset of `ActorContextModule` we pass around realtime service to
 * describe the actor currently taking an action.
 */
export type TaskRealtimeActorInterface =
    | {readonly type: "Session"; getAccountId(): AccountId}
    | {readonly type: "System"}
    | {readonly type: "Anonymous"}
    | {readonly type: "ImpersonatedAccount"; getAccountId(): AccountId}
    | {readonly type: "Bot"; getBotAccountId(): AccountId};

assertAssignableTypes<ActorContextModule, TaskRealtimeActorInterface>();
