import {
    ActorContextModuleBase,
    AnonymousActorContextModule,
    BotActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

export type WorkerActorContextModule =
    | WorkerSessionActorContextModule
    | WorkerSystemActorContextModule
    | WorkerAnonymousActorContextModule
    | WorkerBotActorContextModule;

/**
 * Verify the token and return an actor context module corresponding to
 * the token.
 */
export async function createWorkerActorContextModule(
    tokenAgent: TokenAgent,
    token: string,
): Promise<WorkerActorContextModule> {
    const {serviceName, payload} = await tokenAgent.publicSide.verifyToken(token);

    switch (payload.type) {
        case "Session": {
            return WorkerSessionActorContextModule.dangerouslyNew(
                serviceName,
                payload.sessionId,
                payload.accountId,
            );
        }
        case "System": {
            return WorkerSystemActorContextModule.dangerouslyNew(serviceName, payload.spaceId);
        }
        case "Anonymous": {
            return WorkerAnonymousActorContextModule.dangerouslyNew(serviceName);
        }
        case "Bot": {
            return WorkerBotActorContextModule.dangerouslyNew(
                serviceName,
                payload.spaceId,
                payload.accountId,
                payload.scope,
            );
        }
        default:
            throw exhaustive(payload);
    }
}

interface WorkerActorContextModuleBase extends ActorContextModuleBase {
    /**
     * Throws a `PermissionDeniedError` error if we are not a session actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     *
     * System actors can do a lot but they can't do things like establish a
     * persistent realtime durable object connection.
     */
    authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSessionActorContextModule}>>;

    /**
     * Throws a `PermissionDeniedError` error if we are not a system actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     */
    authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSystemActorContextModule}>>;
}

/**
 * An actor which has a session. A session can only be created by a user who
 * successfully passed an authentication challenge (e.g. enters a one time
 * password provided over email) to prove they are some account.
 */
export class WorkerSessionActorContextModule
    extends ContextModuleBase
    implements WorkerActorContextModuleBase, SessionActorContextModule
{
    public readonly type = "Session";

    private readonly _sessionId: SessionId;
    private readonly _accountId: AccountId;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: TokenServiceName;

    private constructor(serviceName: TokenServiceName, sessionId: SessionId, accountId: AccountId) {
        super();
        this.serviceName = serviceName;
        this._sessionId = sessionId;
        this._accountId = accountId;
    }

    /**
     * Dangerous since if an attacker could call this they could impersonate any
     * account they have the `SessionId` for in our system!
     */
    public static dangerouslyNew(
        serviceName: TokenServiceName,
        sessionId: SessionId,
        accountId: AccountId,
    ) {
        return new WorkerSessionActorContextModule(serviceName, sessionId, accountId);
    }

    public getSessionId(): SessionId {
        return this._sessionId;
    }

    public getAccountId(): AccountId {
        return this._accountId;
    }

    public getPossiblyBotAccountId(): AccountId {
        return this._accountId;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSessionActorContextModule}>> {
        return (this as any)._context;
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSystemActorContextModule}>> {
        throw new PermissionDeniedError("Session actor is not a system actor");
    }

    public fork() {
        return new WorkerSessionActorContextModule(
            this.serviceName,
            this._sessionId,
            this._accountId,
        );
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
export class WorkerSystemActorContextModule
    extends ContextModuleBase
    implements WorkerActorContextModuleBase, SystemActorContextModule
{
    public readonly type = "System";

    private readonly _spaceId: SpaceId;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: TokenServiceName;

    private constructor(serviceName: TokenServiceName, spaceId: SpaceId) {
        super();
        this.serviceName = serviceName;
        this._spaceId = spaceId;
    }

    /**
     * Dangerous since if an attacker could call this they could could broad access
     * to any space in our system!
     */
    public static dangerouslyNew(serviceName: TokenServiceName, spaceId: SpaceId) {
        return new WorkerSystemActorContextModule(serviceName, spaceId);
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSystemActorContextModule}>> {
        return (this as any)._context;
    }

    public fork() {
        return new WorkerSystemActorContextModule(this.serviceName, this._spaceId);
    }
}

export class WorkerAnonymousActorContextModule
    extends ContextModuleBase
    implements WorkerActorContextModuleBase, AnonymousActorContextModule
{
    public readonly type = "Anonymous";

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: TokenServiceName;

    private constructor(serviceName: TokenServiceName) {
        super();
        this.serviceName = serviceName;
    }

    /**
     * Dangerous since you can pass in an arbitrary `serviceName` here. You need to
     * make sure to pass in the right one so you only get access to the procedures
     * made available to your service.
     */
    public static dangerouslyNew(serviceName: TokenServiceName) {
        return new WorkerAnonymousActorContextModule(serviceName);
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSessionActorContextModule}>> {
        throw unauthenticatedSessionError();
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSystemActorContextModule}>> {
        throw new PermissionDeniedError("Anonymous actor is not a system actor");
    }

    public fork() {
        return new WorkerAnonymousActorContextModule(this.serviceName);
    }
}

export class WorkerBotActorContextModule
    extends ContextModuleBase
    implements WorkerActorContextModuleBase, BotActorContextModule
{
    public readonly type = "Bot";

    private readonly _spaceId: SpaceId;
    private readonly _accountId: AccountId;
    private readonly _scope: BotTokenPayloadScope;

    /**
     * Name of the service which initiated the current action. If the browser
     * initiated an action the service name is `AppClient`.
     */
    public readonly serviceName: TokenServiceName;

    private constructor(
        serviceName: TokenServiceName,
        spaceId: SpaceId,
        accountId: AccountId,
        scope: BotTokenPayloadScope,
    ) {
        super();
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
        serviceName: TokenServiceName,
        spaceId: SpaceId,
        accountId: AccountId,
        scope: BotTokenPayloadScope,
    ) {
        return new WorkerBotActorContextModule(serviceName, spaceId, accountId, scope);
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public getBotAccountId(): AccountId {
        return this._accountId;
    }

    public getPossiblyBotAccountId(): AccountId {
        return this._accountId;
    }

    public getScope(): BotTokenPayloadScope {
        return this._scope;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSessionActorContextModule}>> {
        throw new PermissionDeniedError("Bot actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: WorkerSystemActorContextModule}>> {
        throw new PermissionDeniedError("Bot actor is not a system actor");
    }

    public fork() {
        return new WorkerBotActorContextModule(
            this.serviceName,
            this._spaceId,
            this._accountId,
            this._scope,
        );
    }
}
