import {Session} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {PermissionDeniedError} from "~/shared/error/error";
import {Replace} from "~/shared/helpers/types/replace";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

/**
 * Represents who is currently taking an action against our system.
 *
 * Once an actor module has been added to the context you can not switch it for
 * a different actor module. That could result in a privilege escalation!
 */
export type ActorContextModule = SessionActorContextModule | SystemActorContextModule;

interface ActorContextModuleBase extends ContextModuleBase {
    /**
     * Throws a `PermissionDeniedError` error if we are not a session actor.
     * Otherwise returns a context with the correct type for the `actor` module.
     *
     * System actors can do a lot but they can't do things like establish a persistent realtime durable object connection.
     */
    authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>>;
}

/**
 * We don't know who is interacting with our system. They get no privileges and
 * we should always error when you try to access data.
 *
 * If you have an unidentified actor in your context then you may only swap it
 * for certain other actors that allow you to safely escalate privileges. The
 * session context modules allow you to safely escalate privileges since you
 * must have a `Session` object which can only be constructed from a secret
 * `SessionId`.
 *
 * You may not swap an unidentified actor with a system actor since all you
 * need is a `SpaceId`! That would be a dangerous privilege escalation.
 */
export class UnidentifiedActorContextModule<
    Modules extends {[key: string]: ContextModuleBase} = {},
> extends ContextModuleBase<Modules> {}

/**
 * We are in a context that may have an associated session but we're not entirely
 * sure yet. Calling `authenticate()` will upgrade to a
 * `SessionActorContextModule` if we have a session (maybe it's in our cookies)
 * or throw an unauthenticated error if we don't have a session.
 *
 * This class is not a part of our `ActorContextModule` so authorization code
 * does not need to consider it. It mainly exists as an optimization to let us
 * lazily authenticate HTTP requests only when we need it.
 */
export class MaybeSessionActorContextModule<
    Modules extends {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
    } = {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
    },
> extends UnidentifiedActorContextModule<Modules> {
    private readonly _createSession: (context: DynamoContext) => Promise<Session | null>;
    private readonly _sessionPromiseRef: {current: Promise<Session | null> | null};

    constructor(getSession: (context: DynamoContext) => Promise<Session | null>) {
        super();
        this._createSession = getSession;
        this._sessionPromiseRef = {current: null};
    }

    private _getSession(): Promise<Session | null> {
        if (this._sessionPromiseRef.current === null) {
            this._sessionPromiseRef.current = this._createSession(this._context);
        }
        return this._sessionPromiseRef.current;
    }

    public async isAuthenticated(): Promise<boolean> {
        const session = await this._getSession();
        return !!session;
    }

    public async authenticate<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            actor: MaybeSessionActorContextModule;
        },
    >(
        this: MaybeSessionActorContextModule<Modules>,
    ): Promise<Context<Replace<Modules, {actor: SessionActorContextModule}>>> {
        const session = await this._getSession();
        if (!session) throw unauthenticatedSessionError();

        return this._context.clone({
            actor: new SessionActorContextModule(session),
        });
    }
}

/**
 * An actor which has a session. A session can only be created by a user who
 * successfully passed an authentication challenge (e.g. enters a one time
 * password provided over email) to prove they are some account.
 */
export class SessionActorContextModule
    extends MaybeSessionActorContextModule<{
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
    }>
    implements ActorContextModuleBase
{
    public readonly type = "Session";

    private readonly _session: Session;

    constructor(session: Session) {
        super(() => Promise.resolve(session));
        this._session = session;
    }

    public override async isAuthenticated() {
        return true;
    }

    public override async authenticate<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            actor: MaybeSessionActorContextModule;
        },
    >(
        this: MaybeSessionActorContextModule<Modules> & SessionActorContextModule,
    ): Promise<Context<Replace<Modules, {actor: SessionActorContextModule}>>> {
        return this._context as any;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        return (this as any)._context;
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
export class SystemActorContextModule extends ContextModuleBase implements ActorContextModuleBase {
    public readonly type = "System";

    private readonly _spaceId: SpaceId;

    constructor(spaceId: SpaceId) {
        super();
        this._spaceId = spaceId;
    }

    public getSpaceId(): SpaceId {
        return this._spaceId;
    }

    public authorizeSession<Modules extends {actor: ActorContextModuleBase}>(
        this: ContextModuleBase<Modules> & ActorContextModuleBase,
    ): Context<Replace<Modules, {actor: SessionActorContextModule}>> {
        throw new PermissionDeniedError("System actor is not a session actor");
    }
}
