import {Session} from "~/server/dynamo/accounts_table.js";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {TokenServiceName} from "~/server/tokens/token_agent.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";

/**
 * Services that may perform an action against our system.
 */
export type AppActorServiceName = "AppClient" | TokenServiceName;

assertAssignableTypes<AppActorServiceName, TracerServiceName>();

/**
 * Represents who is currently taking an action against our system.
 *
 * Once an actor module has been added to the context you can not switch it for
 * a different actor module. That could result in a privilege escalation!
 */
export type AppActorContextModule = AppSessionActorContextModule | AppSystemActorContextModule;

interface AppActorContextModuleBase extends ContextModuleBase {
    /**
     * Throws a `PermissionDeniedError` error if we are not a session actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     *
     * System actors can do a lot but they can't do things like establish a
     * persistent realtime durable object connection.
     */
    authorizeSession<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSessionActorContextModule}>>;

    /**
     * Throws a `PermissionDeniedError` error if we are not a system actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     */
    authorizeSystem<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSystemActorContextModule}>>;
}

/**
 * No one is interacting with our system. They get no privileges and we should
 * always error when you try to access data.
 *
 * If you have an unidentified actor in your context then you may not swap it
 * with any other actors which would be a privilege escalation.
 */
export class AppUnidentifiedActorContextModule<
    Modules extends {[key: string]: ContextModuleBase} = {},
> extends ContextModuleBase<Modules> {}

/**
 * We are in a context that may have associated authorization but we're not
 * entirely sure yet. Calling `authenticate()` will upgrade to an
 * `AppActorContextModule` if we have a session (maybe it's in our cookies)
 * or throw an unauthenticated error if we don't have a session.
 *
 * This class is not a part of `AppActorContextModule` so authorization code
 * does not need to consider it. It mainly exists as an optimization to let us
 * lazily authenticate HTTP requests only when we need it.
 */
export class AppUnknownActorContextModule<
    Modules extends {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        cache: CacheContextModule;
    } = {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        cache: CacheContextModule;
    },
> extends ContextModuleBase<Modules> {
    private readonly _authenticate: (
        context: Context<Modules>,
    ) => Promise<AppActorContextModule | null>;
    private readonly _contextModuleRef: {current: Promise<AppActorContextModule | null> | null};

    constructor(
        authenticate: (context: Context<Modules>) => Promise<AppActorContextModule | null>,
    ) {
        super();
        this._authenticate = authenticate;
        this._contextModuleRef = {current: null};
    }

    private _getContextModule(): Promise<AppActorContextModule | null> {
        if (this._contextModuleRef.current === null) {
            this._contextModuleRef.current = this._authenticate(this._context);
        }
        return this._contextModuleRef.current;
    }

    public async authenticate<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: AppUnknownActorContextModule;
        },
    >(
        this: AppUnknownActorContextModule<Modules>,
    ): Promise<Context<Replace<Modules, {actor: AppActorContextModule}>>> {
        const contextModule = await this._getContextModule();
        if (!contextModule) throw unauthenticatedSessionError();
        return this._context.clone({actor: contextModule});
    }
}

/**
 * An actor which has a session. A session can only be created by a user who
 * successfully passed an authentication challenge (e.g. enters a one time
 * password provided over email) to prove they are some account.
 */
export class AppSessionActorContextModule
    extends AppUnknownActorContextModule
    implements AppActorContextModuleBase
{
    public readonly type = "Session";

    private readonly _session: Session;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: AppActorServiceName;

    private constructor(serviceName: AppActorServiceName, session: Session) {
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
    public static dangerouslyNew(serviceName: AppActorServiceName, session: Session) {
        return new AppSessionActorContextModule(serviceName, session);
    }

    public override async authenticate<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: AppUnknownActorContextModule;
        },
    >(
        this: AppUnknownActorContextModule<Modules> & AppSessionActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: AppSessionActorContextModule}>>> {
        return this._context as any;
    }

    public authorizeSession<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSessionActorContextModule}>> {
        return (this as any)._context;
    }

    public authorizeSystem<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSystemActorContextModule}>> {
        throw new PermissionDeniedError("Session actor is not a system actor");
    }

    /**
     * Get the `SessionId` we authenticated with.
     */
    public getSessionId(): SessionId {
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
    public getAccount(): Promise<AccountModel> {
        return this._session.getAccount(this._context);
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
export class AppSystemActorContextModule
    extends AppUnknownActorContextModule
    implements AppActorContextModuleBase
{
    public readonly type = "System";

    private readonly _spaceId: SpaceId;

    /**
     * Name of the service which initiated the current action. Only services that
     * can sign tokens can create a system actor context.
     */
    public readonly serviceName: TokenServiceName;

    private constructor(serviceName: TokenServiceName, spaceId: SpaceId) {
        super(() => Promise.resolve(this));
        this.serviceName = serviceName;
        this._spaceId = spaceId;
    }

    /**
     * Dangerous since if an attacker can pass arbitrary input they can get
     * wide ranging information about any space.
     */
    public static dangerouslyNew(serviceName: TokenServiceName, spaceId: SpaceId) {
        return new AppSystemActorContextModule(serviceName, spaceId);
    }

    public override async authenticate<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            cache: CacheContextModule;
            actor: AppUnknownActorContextModule;
        },
    >(
        this: AppUnknownActorContextModule<Modules> & AppSystemActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: AppSystemActorContextModule}>>> {
        return this._context as any;
    }

    public authorizeSession<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: AppActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & AppActorContextModuleBase,
    ): Context<Replace<Modules, {actor: AppSystemActorContextModule}>> {
        return (this as any)._context;
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }
}
