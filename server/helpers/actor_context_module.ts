import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {printSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
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
    | ImpersonatedAccountActorContextModule
    | BotActorContextModule;

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
 *
 * Should never be associated with a bot account. Bot accounts should
 * exclusively use the bot actor.
 */
export interface SessionActorContextModule extends ActorContextModuleBase {
    readonly type: "Session";

    getSessionId(): SessionId;
    getAccountId(): AccountId;

    // Returns the same thing as `getAccountId()`. Has a scarier name so you
    // consider the possibility that the actor is a bot account.
    getPossiblyBotAccountId(): AccountId;
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
 *
 * Should never be associated with a bot account. Bot accounts should
 * exclusively use the bot actor.
 */
export interface ImpersonatedAccountActorContextModule extends ActorContextModuleBase {
    readonly type: "ImpersonatedAccount";

    getSpaceId(): SpaceId;
    getAccountId(): AccountId;

    // Returns the same thing as `getAccountId()`. Has a scarier name so you
    // consider the possibility that the actor is a bot account.
    getPossiblyBotAccountId(): AccountId;
}

/**
 * Bot account actors have access to everything in a scope and everything that
 * the accounts in the scope ALL have access to. Bot accounts are only ever in
 * one space so it's implied that a bot actor only has access to one space.
 */
export interface BotActorContextModule extends ActorContextModuleBase {
    readonly type: "Bot";

    getSpaceId(): SpaceId;

    // We use the name `getBotAccountId()` instead of `getAccountId()` to make it
    // intentionally awkward if the user wants to call `context.actor.getAccountId()`
    // with `ActorBotContextModule | ActorSessionContextModule`. Bot actors behave
    // differently than session actors with regard to permissions. Bot accounts get
    // access to a scope and only content in that scope. They can't be granted
    // access via an `AccessPolicy`.
    //
    // Generally you'll want a special case for bot accounts in your
    // authorization code.
    getBotAccountId(): AccountId;

    /**
     * The scope of the bot actor. The actor can only access what ALL non-bot
     * accounts within the scope have access to.
     *
     * We assume the scope is a valid entity in the same space as the bot
     * account. If the entity doesn't exist or is in another space, that's a bug.
     *
     * We implicitly have access to the `AccessPolicy` of the scoped entity. Since
     * we need to know what accounts are in the scope to know what else the bot
     * actor has access to.
     */
    getScope(): BotTokenPayloadScope;

    // Returns the same thing as `getAccountId()`. Has a scarier name so you
    // consider the possibility that the actor is a bot account.
    getPossiblyBotAccountId(): AccountId;
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
        case "Bot": {
            const scope = actor.getScope();

            return `Bot:${actor.getBotAccountId()}-${
                scope.type === "Space" ? "Space" : printSearchDynamicEntityId(scope)
            }`;
        }
        default:
            throw exhaustive(actor);
    }
}
