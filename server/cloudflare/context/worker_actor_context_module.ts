import {
    ActorContextModuleBase,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {TokenAgentBase} from "~/server/tokens/token_agent.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

export type WorkerActorContextModule =
    | WorkerSessionActorContextModule
    | WorkerSystemActorContextModule;

/**
 * Verify the token and return an actor context module corresponding to
 * the token.
 */
export async function createWorkerActorContextModule(
    tokenAgent: TokenAgentBase,
    token: string,
): Promise<WorkerActorContextModule> {
    const {payload} = await tokenAgent.verifyToken(token);

    switch (payload.type) {
        case "Session": {
            return WorkerSessionActorContextModule.dangerouslyNew(
                payload.sessionId,
                payload.accountId,
            );
        }
        case "System": {
            return WorkerSystemActorContextModule.dangerouslyNew(payload.spaceId);
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

    private constructor(sessionId: SessionId, accountId: AccountId) {
        super();
        this._sessionId = sessionId;
        this._accountId = accountId;
    }

    /**
     * Dangerous since if an attacker could call this they could impersonate any
     * account they have the `SessionId` for in our system!
     */
    public static dangerouslyNew(sessionId: SessionId, accountId: AccountId) {
        return new WorkerSessionActorContextModule(sessionId, accountId);
    }

    public getSessionId(): SessionId {
        return this._sessionId;
    }

    public getAccountId(): AccountId {
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

    private constructor(spaceId: SpaceId) {
        super();
        this._spaceId = spaceId;
    }

    /**
     * Dangerous since if an attacker could call this they could could broad access
     * to any space in our system!
     */
    public static dangerouslyNew(spaceId: SpaceId) {
        return new WorkerSystemActorContextModule(spaceId);
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
}
