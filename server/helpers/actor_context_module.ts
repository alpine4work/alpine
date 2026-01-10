import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {BotTokenPayloadScope, TokenPayload} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {printSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Services that may perform an action against our system.
 */
export type ActorServiceName =
    | "Admin"
    | "Test"
    | "AppClient"
    | TokenServiceName
    | "JobQueueService"
    | "MigrationService";

assertAssignableTypes<ActorServiceName, TracerServiceName>();

/**
 * Represents who is currently taking an action against our system.
 *
 * Once an actor module has been added to the context you can not switch it for
 * a different actor module. That could result in a privilege escalation!
 */
export type ActorContextModule =
    | SessionActorContextModule
    | SystemActorContextModule
    | AnonymousActorContextModule
    | ImpersonatedAccountActorContextModule
    | BotActorContextModule;

interface ActorContextModuleBase extends ContextModuleBase {
    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    readonly serviceName: ActorServiceName;

    /**
     * Get data to propagate to all spans in the trace.
     */
    getPropagatedData(): TracerEventData;

    /**
     * Get the token payload for this actor so we can create a new token with the
     * same authorization.
     */
    getTokenPayload(): TokenPayload;

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
 * We are in a context that may have associated authorization but we're not
 * entirely sure yet. Calling `authenticate()` will upgrade to an
 * `ActorContextModule` if we have a session (maybe it's in our cookies)
 * or throw an unauthenticated error if we don't have a session.
 *
 * This class is not a part of the `ActorContextModule` union so authorization
 * code does not need to consider it. It mainly exists as an optimization to
 * let us lazily authenticate HTTP requests only when we need it.
 */
export class UnknownActorContextModule<Modules extends {} = {}> extends ContextModuleBase<Modules> {
    private readonly _authenticate: (context: Context<Modules>) => Promise<ActorContextModule>;
    private readonly _contextModuleRef: {current: Promise<ActorContextModule> | null};

    constructor(authenticate: (context: Context<Modules>) => Promise<ActorContextModule>) {
        super();
        this._authenticate = authenticate;
        this._contextModuleRef = {current: null};
    }

    private _getContextModule(): Promise<ActorContextModule> {
        if (this._contextModuleRef.current === null) {
            this._contextModuleRef.current = this._authenticate(this._context);
        }
        return this._contextModuleRef.current;
    }

    public async isAuthenticatedSession() {
        const contextModule = await this._getContextModule();
        return contextModule instanceof SessionActorContextModule;
    }

    public async authenticate<CurrentModules extends Modules & {tracer: TracerContextModule}>(
        this: ContextModuleBase<CurrentModules> & UnknownActorContextModule<Modules>,
    ): Promise<
        Context<Replace<CurrentModules, {actor: ActorContextModule; tracer: TracerContextModule}>>
    > {
        const contextModule = await this._getContextModule();

        return this._context.clone({
            actor: contextModule,
            tracer: new TracerContextModule(
                this._context.tracer
                    .getTracer()
                    .withPropagatedData(contextModule.getPropagatedData()),
            ),
        });
    }
}

/**
 * When an account signs in to our service they're represented with a session
 * actor. Their session actor has access to everything the account has access
 * to.
 *
 * Should never be associated with a bot account. Bot accounts should
 * exclusively use the bot actor.
 */
export class SessionActorContextModule
    extends UnknownActorContextModule
    implements ActorContextModuleBase
{
    public readonly type = "Session";

    private readonly _sessionId: SessionId;
    private readonly _accountId: AccountId;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: ActorServiceName;

    private constructor(serviceName: ActorServiceName, sessionId: SessionId, accountId: AccountId) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._sessionId = sessionId;
        this._accountId = accountId;
    }

    /**
     * Dangerous since we don't check whether the `SessionId` was revoked. Make
     * sure to call `getSessionIfExists()` to make sure the session is still valid
     * before calling this function.
     */
    public static dangerouslyNewWithoutCheckingIfRevoked(
        serviceName: ActorServiceName,
        sessionId: SessionId,
        accountId: AccountId,
    ) {
        return new SessionActorContextModule(serviceName, sessionId, accountId);
    }

    public override async isAuthenticatedSession() {
        return true;
    }

    public override async authenticate<Modules extends {}>(
        this: ContextModuleBase<Modules> & SessionActorContextModule,
    ): Promise<
        Context<Replace<Modules, {actor: SessionActorContextModule; tracer: TracerContextModule}>>
    > {
        return this._context as any;
    }

    /**
     * Get the token payload for the session so we can sign new tokens for
     * communicating with other services in our system.
     */
    public getTokenPayload(): TokenPayload {
        return {
            type: "Session",
            sessionId: this._sessionId,
            accountId: this._accountId,
        };
    }

    public getPropagatedData(): TracerEventData {
        return {
            context: {
                actor: "Session",
                accountId: this._accountId,
            },
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        return (this as any)._context;
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>> {
        throw new PermissionDeniedError("Session actor is not a system actor");
    }

    /**
     * Get the `SessionId` we authenticated with.
     */
    public getSessionId(): SessionId {
        return this._sessionId;
    }

    /**
     * What is the `AccountId` connected to our service? Returns the same
     * `AccountId` as `getAccount()` but without loading the account from the
     * database.
     */
    public getAccountId(): AccountId {
        return this._accountId;
    }

    /**
     * Returns the same thing as `getAccountId()`. Has a scarier name so you
     * consider the possibility that the actor is a bot account.
     */
    public getPossiblyBotAccountId(): AccountId {
        return this._accountId;
    }

    public fork() {
        return new SessionActorContextModule(this.serviceName, this._sessionId, this._accountId);
    }
}

/**
 * A system actor has access to all data within a space. Be careful when using
 * this context module! Only internal services should be able to use it. A user
 * from the public internet should not be able to take an action with our
 * system context.
 *
 * System contexts only have access to one space at a time to limit the power
 * of the system context and prevent accidental issues.
 */
export class SystemActorContextModule
    extends UnknownActorContextModule
    implements ActorContextModuleBase
{
    public readonly type = "System";

    private readonly _spaceId: SpaceId;

    /**
     * Name of the service which initiated the current action. Only services that
     * can sign tokens can create a system actor context.
     */
    public readonly serviceName: ActorServiceName;

    private constructor(serviceName: ActorServiceName, spaceId: SpaceId) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._spaceId = spaceId;
    }

    /**
     * Dangerous since if an attacker can pass arbitrary input they can get
     * wide ranging information about any space.
     */
    public static dangerouslyNew(serviceName: ActorServiceName, spaceId: SpaceId) {
        return new SystemActorContextModule(serviceName, spaceId);
    }

    public override async isAuthenticatedSession() {
        return false;
    }

    public override async authenticate<Modules extends {}>(
        this: ContextModuleBase<Modules> & SystemActorContextModule,
    ): Promise<
        Context<Replace<Modules, {actor: SystemActorContextModule; tracer: TracerContextModule}>>
    > {
        return this._context as any;
    }

    public getTokenPayload(): TokenPayload {
        return {
            type: "System",
            spaceId: this._spaceId,
        };
    }

    public getPropagatedData(): TracerEventData {
        return {
            context: {
                actor: "System",
                spaceId: this._spaceId,
            },
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>> {
        return (this as any)._context;
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public fork() {
        return new SystemActorContextModule(this.serviceName, this._spaceId);
    }

    // Allow replacing system context modules with the impersonated account context
    // module if the impersonated account context module is for the same `SpaceId`.
    public override _allowReplace(otherModule: ContextModuleBase) {
        return (
            otherModule instanceof ImpersonatedAccountActorContextModule &&
            otherModule.getSpaceId() === this.getSpaceId()
        );
    }
}

/**
 * Anonymous actors aren't signed into our service. They may be viewing a
 * read-only document or some other shared link.
 */
export class AnonymousActorContextModule
    extends UnknownActorContextModule
    implements ActorContextModuleBase
{
    public readonly type = "Anonymous";

    /**
     * Name of the service which initiated the current action. Only services that
     * can sign tokens can create an anonymous actor context.
     */
    public readonly serviceName: ActorServiceName;

    private constructor(serviceName: ActorServiceName) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
    }

    /**
     * Dangerous since you can pass in an arbitrary `serviceName` here. You need to
     * make sure to pass in the right one so you only get access to the procedures
     * made available to your service.
     */
    public static dangerouslyNew(serviceName: ActorServiceName) {
        return new AnonymousActorContextModule(serviceName);
    }

    public getTokenPayload(): TokenPayload {
        return {type: "Anonymous"};
    }

    public getPropagatedData(): TracerEventData {
        return {
            context: {
                actor: "Anonymous",
            },
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        throw unauthenticatedSessionError();
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>> {
        throw new PermissionDeniedError("Anonymous actor is not a system actor");
    }

    public fork() {
        return new AnonymousActorContextModule(this.serviceName);
    }
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
export class ImpersonatedAccountActorContextModule
    extends UnknownActorContextModule
    implements ActorContextModuleBase
{
    public readonly type = "ImpersonatedAccount";

    public readonly serviceName: ActorServiceName;
    private readonly _spaceId: SpaceId;
    private readonly _accountId: AccountId;

    private constructor(serviceName: ActorServiceName, spaceId: SpaceId, accountId: AccountId) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._spaceId = spaceId;
        this._accountId = accountId;
    }

    /**
     * Dangerous since you can pass in an arbitrary `SpaceId` and `AccountId` here.
     * We don't verify that the `SpaceId` exists or the `AccountId` is a member of
     * the space. You should use `impersonateAccountAsSystemContext()` to construct
     * this context module.
     */
    public static dangerouslyNew(
        actorContextModule: SystemActorContextModule,
        accountId: AccountId,
    ) {
        // Double check that we have a real actor context module class instance.
        assert(actorContextModule instanceof SystemActorContextModule);

        return new ImpersonatedAccountActorContextModule(
            actorContextModule.serviceName,
            actorContextModule.getSpaceId(),
            accountId,
        );
    }

    public getTokenPayload(): TokenPayload {
        // NOTE(calebmer): We don't need cross-service communication for impersonated
        // actors right now but may need the capability in the future.
        throw new InternalError("Can’t create token for impersonated account actor");
    }

    public getPropagatedData(): TracerEventData {
        return {
            context: {
                actor: "ImpersonatedAccount",
                spaceId: this._spaceId,
                accountId: this._accountId,
            },
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        throw unauthenticatedSessionError();
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>> {
        throw new PermissionDeniedError("Impersonated account actor is not a system actor");
    }

    public getSpaceId() {
        return this._spaceId;
    }

    public getAccountId() {
        return this._accountId;
    }

    /**
     * Returns the same thing as `getAccountId()`. Has a scarier name so you
     * consider the possibility that the actor is a bot account.
     */
    public getPossiblyBotAccountId(): AccountId {
        return this._accountId;
    }

    public fork() {
        return new ImpersonatedAccountActorContextModule(
            this.serviceName,
            this._spaceId,
            this._accountId,
        );
    }
}

/**
 * Bot account actors have access to everything in a scope and everything that
 * the accounts in the scope ALL have access to. Bot accounts are only ever in
 * one space so it's implied that a bot actor only has access to one space.
 */
export class BotActorContextModule
    extends UnknownActorContextModule
    implements ActorContextModuleBase
{
    public readonly type = "Bot";

    private readonly _spaceId: SpaceId;
    private readonly _accountId: AccountId;
    private readonly _scope: BotTokenPayloadScope;

    /**
     * Name of the service which initiated the current action. Only services that
     * can sign tokens can create a system actor context.
     */
    public readonly serviceName: ActorServiceName;

    private constructor(
        serviceName: ActorServiceName,
        spaceId: SpaceId,
        accountId: AccountId,
        scope: BotTokenPayloadScope,
    ) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._spaceId = spaceId;
        this._accountId = accountId;
        this._scope = scope;
    }

    /**
     * Dangerous since you can pass in an arbitrary `accountId`, `scope`, and
     * `serviceName` here. An attacker could get broad access to our system if they
     * can call this function!
     */
    public static dangerouslyNew(
        serviceName: ActorServiceName,
        spaceId: SpaceId,
        accountId: AccountId,
        scope: BotTokenPayloadScope,
    ) {
        return new BotActorContextModule(serviceName, spaceId, accountId, scope);
    }

    public override async isAuthenticatedSession() {
        return false;
    }

    public override async authenticate<Modules extends {}>(
        this: ContextModuleBase<Modules> & BotActorContextModule,
    ): Promise<
        Context<Replace<Modules, {actor: BotActorContextModule; tracer: TracerContextModule}>>
    > {
        return this._context as any;
    }

    public getTokenPayload(): TokenPayload {
        return {
            type: "Bot",
            spaceId: this._spaceId,
            accountId: this._accountId,
            scope: this._scope,
        };
    }

    public getPropagatedData(): TracerEventData {
        return {
            context: {
                actor: "Bot",
                spaceId: this._spaceId,
                botAccountId: this._accountId,
            },
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        throw new PermissionDeniedError("Bot actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SystemActorContextModule}>> {
        throw new PermissionDeniedError("Bot actor is not a system actor");
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    /**
     * We use the name `getBotAccountId()` instead of `getAccountId()` to make it
     * intentionally awkward if the user wants to call `context.actor.getAccountId()`
     * with `ActorBotContextModule | ActorSessionContextModule`. Bot actors behave
     * differently than session actors with regard to permissions. Bot accounts get
     * access to a scope and only content in that scope. They can't be granted
     * access via an `AccessPolicy`.
     *
     * Generally you'll want a special case for bot accounts in your
     * authorization code.
     */
    public getBotAccountId(): AccountId {
        return this._accountId;
    }

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
    public getScope(): BotTokenPayloadScope {
        return this._scope;
    }

    /**
     * Returns the same thing as `getBotAccountId()`. Has a scarier name so you
     * consider the possibility that the actor is a bot account.
     */
    public getPossiblyBotAccountId(): AccountId {
        return this._accountId;
    }

    public fork() {
        return new BotActorContextModule(
            this.serviceName,
            this._spaceId,
            this._accountId,
            this._scope,
        );
    }
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
