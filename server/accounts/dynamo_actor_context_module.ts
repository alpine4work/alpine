import {Session} from "~/server/accounts/accounts_table.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModuleBase,
    ActorServiceName,
    AnonymousActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {TokenPayload} from "~/server/tokens/token_payload.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Represents who is currently taking an action against our system.
 *
 * Once an actor module has been added to the context you can not switch it for
 * a different actor module. That could result in a privilege escalation!
 */
export type DynamoActorContextModule =
    | DynamoSessionActorContextModule
    | DynamoSystemActorContextModule
    | DynamoAnonymousActorContextModule
    | DynamoImpersonatedAccountActorContextModule;

interface DynamoActorContextModuleBase extends ActorContextModuleBase {
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
    ): Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>>;

    /**
     * Throws a `PermissionDeniedError` error if we are not a system actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     */
    authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>>;
}

/**
 * We are in a context that may have associated authorization but we're not
 * entirely sure yet. Calling `authenticate()` will upgrade to an
 * `DynamoActorContextModule` if we have a session (maybe it's in our cookies)
 * or throw an unauthenticated error if we don't have a session.
 *
 * This class is not a part of `DynamoActorContextModule` so authorization code
 * does not need to consider it. It mainly exists as an optimization to let us
 * lazily authenticate HTTP requests only when we need it.
 */
export class DynamoUnknownActorContextModule extends ContextModuleBase<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    cache: CacheContextModule;
}> {
    private readonly _authenticate: (
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
        }>,
    ) => Promise<DynamoActorContextModule>;
    private readonly _contextModuleRef: {current: Promise<DynamoActorContextModule> | null};

    constructor(
        authenticate: (
            context: Context<{
                process: ProcessContextModule;
                tracer: TracerContextModule;
                dynamo: DynamoContextModule;
                cache: CacheContextModule;
            }>,
        ) => Promise<DynamoActorContextModule>,
    ) {
        super();
        this._authenticate = authenticate;
        this._contextModuleRef = {current: null};
    }

    private _getContextModule(): Promise<DynamoActorContextModule> {
        if (this._contextModuleRef.current === null) {
            this._contextModuleRef.current = this._authenticate(this._context);
        }
        return this._contextModuleRef.current;
    }

    public async isAuthenticatedSession() {
        const contextModule = await this._getContextModule();
        return contextModule instanceof DynamoSessionActorContextModule;
    }

    public async authenticate<
        Modules extends {
            process: ProcessContextModule;
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: DynamoUnknownActorContextModule;
        },
    >(
        this: ContextModuleBase<Modules> & DynamoUnknownActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: DynamoActorContextModule}>>> {
        const contextModule = await this._getContextModule();
        return this._context.clone({actor: contextModule});
    }
}

/**
 * An actor which has a session. A session can only be created by a user who
 * successfully passed an authentication challenge (e.g. enters a one time
 * password provided over email) to prove they are some account.
 */
export class DynamoSessionActorContextModule
    extends DynamoUnknownActorContextModule
    implements DynamoActorContextModuleBase, SessionActorContextModule
{
    public readonly type = "Session";

    private readonly _session: Session;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: ActorServiceName;

    private constructor(serviceName: ActorServiceName, session: Session) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._session = session;
    }

    /**
     * Dangerous since while a `Session` object is safe to construct, you can
     * pass in an arbitrary `serviceName` here. You need to make sure to pass in
     * the right one so you only get access to the RPCs made available to your
     * service.
     */
    public static dangerouslyNew(serviceName: ActorServiceName, session: Session) {
        return new DynamoSessionActorContextModule(serviceName, session);
    }

    public override async isAuthenticatedSession() {
        return true;
    }

    public override async authenticate<
        Modules extends {
            process: ProcessContextModule;
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: DynamoUnknownActorContextModule;
        },
    >(
        this: ContextModuleBase<Modules> & DynamoSessionActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>>> {
        return this._context as any;
    }

    /**
     * Get the token payload for the session so we can sign new tokens for
     * communicating with other services in our system.
     *
     * If this is an impersonated session (a session created by
     * `impersonateAccountAsSystemContext()`) then we throw an `InternalError`.
     * We don't currently support creating tokens for communicating with other
     * services as an impersonated session.
     */
    public getTokenPayload(): TokenPayload {
        if (this._session.id === "Impersonated") {
            throw new InternalError("Can’t get token payload for impersonated session");
        }

        return {
            type: "Session",
            sessionId: this._session.id,
            accountId: this._session.accountId,
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>> {
        return (this as any)._context;
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>> {
        throw new PermissionDeniedError("Session actor is not a system actor");
    }

    /**
     * Get the `SessionId` we authenticated with.
     *
     * If this is an impersonated session (a session created by
     * `impersonateAccountAsSystemContext()`) then we throw an
     * `InternalError`.
     */
    public getSessionId(): SessionId {
        if (this._session.id === "Impersonated") {
            throw new InternalError("Can’t get `SessionId` for impersonated session");
        }

        return this._session.id;
    }

    /**
     * What is the `AccountId` connected to our service? Returns the same
     * `AccountId` as `getAccount()` but without loading the account from the
     * database.
     */
    public getAccountId(): AccountId {
        return this._session.accountId;
    }

    /**
     * Returns the account connected to our service.
     */
    public getAccount(): Promise<AccountModelWithoutSpace> {
        return this._session.getAccount(this._context);
    }

    /**
     * Returns the account connected to our service.
     */
    public getAccountAndHasInternalAccess(): Promise<{
        readonly account: AccountModelWithoutSpace;
        readonly hasInternalAccess: boolean;
    }> {
        return this._session.getAccountAndHasInternalAccess(this._context);
    }

    public fork() {
        return new DynamoSessionActorContextModule(this.serviceName, this._session);
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
export class DynamoSystemActorContextModule
    extends DynamoUnknownActorContextModule
    implements DynamoActorContextModuleBase, SystemActorContextModule
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
        return new DynamoSystemActorContextModule(serviceName, spaceId);
    }

    public override async isAuthenticatedSession() {
        return false;
    }

    public override async authenticate<
        Modules extends {
            process: ProcessContextModule;
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: DynamoUnknownActorContextModule;
        },
    >(
        this: ContextModuleBase<Modules> & DynamoSystemActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>>> {
        return this._context as any;
    }

    public getTokenPayload(): TokenPayload {
        return {
            type: "System",
            spaceId: this._spaceId,
        };
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>> {
        return (this as any)._context;
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public fork() {
        return new DynamoSystemActorContextModule(this.serviceName, this._spaceId);
    }

    // Allow replacing system context modules with the impersonated account context
    // module if the impersonated account context module is for the same `SpaceId`.
    public override _allowReplace(otherModule: ContextModuleBase) {
        return (
            otherModule instanceof DynamoImpersonatedAccountActorContextModule &&
            otherModule.getSpaceId() === this.getSpaceId()
        );
    }
}

export class DynamoAnonymousActorContextModule
    extends DynamoUnknownActorContextModule
    implements DynamoActorContextModuleBase, AnonymousActorContextModule
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
        return new DynamoAnonymousActorContextModule(serviceName);
    }

    public getTokenPayload(): TokenPayload {
        return {type: "Anonymous"};
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>> {
        throw unauthenticatedSessionError();
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>> {
        throw new PermissionDeniedError("Anonymous actor is not a system actor");
    }

    public fork() {
        return new DynamoAnonymousActorContextModule(this.serviceName);
    }
}

export class DynamoImpersonatedAccountActorContextModule
    extends DynamoUnknownActorContextModule
    implements DynamoActorContextModuleBase, ImpersonatedAccountActorContextModule
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
        actorContextModule: DynamoSystemActorContextModule,
        accountId: AccountId,
    ) {
        // Double check that we have a real actor context module class instance.
        assert(actorContextModule instanceof DynamoSystemActorContextModule);

        return new DynamoImpersonatedAccountActorContextModule(
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

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSessionActorContextModule}>> {
        throw unauthenticatedSessionError();
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: DynamoSystemActorContextModule}>> {
        throw new PermissionDeniedError("Impersonated account actor is not a system actor");
    }

    public getSpaceId() {
        return this._spaceId;
    }

    public getAccountId() {
        return this._accountId;
    }

    public fork() {
        return new DynamoImpersonatedAccountActorContextModule(
            this.serviceName,
            this._spaceId,
            this._accountId,
        );
    }
}
