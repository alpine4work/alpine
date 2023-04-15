import {Session} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {Replace} from "~/shared/helpers/types/replace";
import {AccountId, SessionId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

/**
 * Context module for determining whether a user is authenticated against our
 * service using a session cookie or similar mechanism.
 *
 * The `authenticate()` method returns a context module with methods that let
 * you ask questions about the authenticated account.
 */
export class UnauthenticatedSessionAuthContextModule<
    Modules extends {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        auth: UnauthenticatedSessionAuthContextModule;
    } = {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        auth: UnauthenticatedSessionAuthContextModule;
    },
> extends ContextModuleBase<Modules> {
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
            auth: UnauthenticatedSessionAuthContextModule;
        },
    >(
        this: UnauthenticatedSessionAuthContextModule<Modules>,
    ): Promise<Context<Replace<Modules, {auth: AuthenticatedSessionAuthContextModule}>>> {
        const session = await this._getSession();
        if (!session) throw unauthenticatedSessionError();

        return this._context.clone({
            auth: new AuthenticatedSessionAuthContextModule(session),
        });
    }
}

export interface AuthenticatedAuthContextModule
    extends ContextModuleBase<{
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
    }> {
    getAccountId(): AccountId;
    getAccount(): Promise<AccountModel>;
}

/**
 * Context module after we've successfully authenticated a user with our
 * service. Provides access to session information like the authenticated
 * account's ID.
 */
export class AuthenticatedSessionAuthContextModule
    extends UnauthenticatedSessionAuthContextModule<{
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        auth: AuthenticatedSessionAuthContextModule;
    }>
    implements AuthenticatedAuthContextModule
{
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
            auth: UnauthenticatedSessionAuthContextModule;
        },
    >(
        this: UnauthenticatedSessionAuthContextModule<Modules> &
            AuthenticatedSessionAuthContextModule,
    ): Promise<Context<Replace<Modules, {auth: AuthenticatedSessionAuthContextModule}>>> {
        return this._context as any;
    }

    /**
     * Get the ID of the session we authenticated with.
     */
    public getSessionId(): SessionId {
        return this._session.id;
    }

    /**
     * What is the ID of the account connected to our service? Returns the same ID
     * as `getAccount()` but without loading the account from the database.
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
