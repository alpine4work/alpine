import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error";
import {Account, Session} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {Replace} from "~/shared/helpers/types/replace";
import {Id} from "~/shared/id/id";

/**
 * Context module for determining whether a user is authenticated against our
 * service using a session cookie or similar mechanism.
 *
 * The `authenticate()` method returns a context module with methods that let
 * you ask questions about the authenticated account.
 */
export class UnauthenticatedAuthContextModule<
    Modules extends {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        auth: UnauthenticatedAuthContextModule;
    } = {
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        auth: UnauthenticatedAuthContextModule;
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
            auth: UnauthenticatedAuthContextModule;
        },
    >(
        this: UnauthenticatedAuthContextModule<Modules>,
    ): Promise<Context<Replace<Modules, {auth: AuthenticatedAuthContextModule}>>> {
        const session = await this._getSession();
        if (!session) throw unauthenticatedSessionError();

        return this._context.clone({
            auth: new AuthenticatedAuthContextModule(session),
        });
    }
}

/**
 * Context module after we've successfully authenticated a user with our
 * service. Provides access to session information like the authenticated
 * account's ID.
 */
export class AuthenticatedAuthContextModule extends UnauthenticatedAuthContextModule<{
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    auth: AuthenticatedAuthContextModule;
}> {
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
            auth: UnauthenticatedAuthContextModule;
        },
    >(
        this: UnauthenticatedAuthContextModule<Modules> & AuthenticatedAuthContextModule,
    ): Promise<Context<Replace<Modules, {auth: AuthenticatedAuthContextModule}>>> {
        return this._context as any;
    }

    /**
     * Get the ID of the session we authenticated with.
     */
    public getSessionId(): Id {
        return this._session.id;
    }

    /**
     * What is the ID of the account connected to our service? Returns the same ID
     * as `getAccount()` but without loading the account from the database.
     */
    public getAccountId(): Id {
        return this._session.accountId;
    }

    /**
     * Returns the account connected to our service.
     */
    public getAccount(): Promise<Account> {
        return this._session.getAccount(this._context);
    }
}
