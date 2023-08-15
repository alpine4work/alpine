import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * An interface that's a supertype of `AppActorContextModule` and
 * `WorkerActorContextModule` with just the essentials.
 *
 * Useful for tests. Code written against `ActorContextModule` can
 * accept either an `AppActorContextModule` or a `WorkerActorContextModule`.
 */
export type ActorContextModule = SessionActorContextModule | SystemActorContextModule;

export interface ActorContextModuleBase extends ContextModuleBase {
    /**
     * Throws a `PermissionDeniedError` error if we are not a session actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     *
     * System actors can do a lot but they can't do things like establish a
     * persistent realtime durable object connection.
     */
    authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>>;

    /**
     * Throws a `PermissionDeniedError` error if we are not a system actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     */
    authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>>;
}

export interface SessionActorContextModule extends ActorContextModuleBase {
    readonly type: "Session";

    getSessionId(): SessionId;
    getAccountId(): AccountId;
}

export interface SystemActorContextModule extends ActorContextModuleBase {
    readonly type: "System";

    getSpaceId(): SpaceId;
}
