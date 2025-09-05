import {
    ActorContextModuleBase,
    ActorServiceName,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

export type TestActorContextModule = TestSessionActorContextModule | TestSystemActorContextModule;

interface TestActorContextModuleBase extends ActorContextModuleBase {
    /**
     * Throws a `PermissionDeniedError` error if we are not a session actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     *
     * System actors can do a lot but they can't do things like establish a
     * persistent realtime durable object connection.
     */
    authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: TestSessionActorContextModule}>>;

    /**
     * Throws a `PermissionDeniedError` error if we are not a system actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     */
    authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: TestSystemActorContextModule}>>;
}

/**
 * An actor which has a session. A session can only be created by a user who
 * successfully passed an authentication challenge (e.g. enters a one time
 * password provided over email) to prove they are some account.
 */
export class TestSessionActorContextModule
    extends ContextModuleBase
    implements TestActorContextModuleBase, SessionActorContextModule
{
    public readonly type = "Session";

    public readonly serviceName: ActorServiceName = "Test";

    private readonly _sessionId: SessionId;
    private readonly _accountId: AccountId;

    constructor(sessionId: SessionId, accountId: AccountId) {
        // May only be constructed in Jest tests. Dangerous to use elsewhere!
        assert(import.meta.jest);

        super();
        this._sessionId = sessionId;
        this._accountId = accountId;
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
    ): Context<Replace<Modules, {actor: TestSessionActorContextModule}>> {
        return (this as any)._context;
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: TestSystemActorContextModule}>> {
        throw new PermissionDeniedError("Session actor is not a system actor");
    }

    public fork() {
        return new TestSessionActorContextModule(this._sessionId, this._accountId);
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
export class TestSystemActorContextModule
    extends ContextModuleBase
    implements TestActorContextModuleBase, SystemActorContextModule
{
    public readonly type = "System";

    public readonly serviceName: ActorServiceName = "Test";

    private readonly _spaceId: SpaceId;

    constructor(spaceId: SpaceId) {
        // May only be constructed in Jest tests. Dangerous to use elsewhere!
        assert(import.meta.jest);

        super();
        this._spaceId = spaceId;
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: TestSessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }

    public authorizeSystem<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: TestSystemActorContextModule}>> {
        return (this as any)._context;
    }

    public fork() {
        return new TestSystemActorContextModule(this._spaceId);
    }
}
