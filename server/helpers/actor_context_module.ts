import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";

/**
 * Services that may perform an action against our system.
 */
export type ActorServiceName =
    | "Adhoc"
    | "Test"
    | "AppClient"
    | TokenServiceName
    | "JobQueueService"
    | "MigrationService";

assertAssignableTypes<ActorServiceName, TracerServiceName>();

/**
 * An interface that's a supertype of `AppActorContextModule` and
 * `WorkerActorContextModule` with just the essentials.
 *
 * Useful for tests. Code written against `ActorContextModule` can
 * accept either an `AppActorContextModule` or a `WorkerActorContextModule`.
 */
export type ActorContextModule =
    | SessionActorContextModule
    | SystemActorContextModule
    | AnonymousActorContextModule
    | ImpersonatedAccountActorContextModule;

export interface ActorContextModuleBase extends ContextModuleBase, ForkableContextModuleBase {
    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    readonly serviceName: ActorServiceName;

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

/**
 * When an account signs in to our service they're represented with a session
 * actor. Their session actor has access to everything the account has access
 * to.
 */
export interface SessionActorContextModule extends ActorContextModuleBase {
    readonly type: "Session";

    getSessionId(): SessionId;
    getAccountId(): AccountId;
}

/**
 * System actors have access to everything in a single space.
 */
export interface SystemActorContextModule extends ActorContextModuleBase {
    readonly type: "System";

    getSpaceId(): SpaceId;
}

/**
 * Anonymous actors aren't signed into our service. They may be viewing a
 * read-only document or some other shared link.
 */
export interface AnonymousActorContextModule extends ActorContextModuleBase {
    readonly type: "Anonymous";
}

/**
 * Impersonated account actors have access to everything the account has access
 * to in a single space. They don't have access to documents or tasks or
 * anything else the account has access to in another space.
 *
 * Since system actors have access to everything in a space, they're allowed to
 * impersonate any accounts in their space.
 */
export interface ImpersonatedAccountActorContextModule extends ActorContextModuleBase {
    readonly type: "ImpersonatedAccount";

    getSpaceId(): SpaceId;
    getAccountId(): AccountId;
}

/**
 * Returns a string key you can use to quickly tell if an actor has changed.
 */
export function getActorContextModuleKey(actor: ActorContextModule): string {
    switch (actor.type) {
        case "Session":
            return `Session:${actor.getSessionId()}`;
        case "System":
            return `System:${actor.getSpaceId()}`;
        case "Anonymous":
            return "Anonymous";
        case "ImpersonatedAccount":
            return `ImpersonatedAccount:${actor.getSpaceId()}-${actor.getAccountId()}`;
        default:
            throw exhaustive(actor);
    }
}
