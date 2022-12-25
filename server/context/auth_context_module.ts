import {AwsContextModule} from "~/server/context/aws_context_module";
import {unauthenticatedSessionError} from "~/server/context/helpers/unauthenticated_session_error";
import {Account, Session} from "~/server/dynamo/accounts_table";
import {Context} from "~/shared/context/context";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Replace} from "~/shared/helpers/types/replace";
import {Id} from "~/shared/id/id";

/**
 * Context module for determining whether a user is authenticated against our
 * service using a session cookie or similar mechanism.
 *
 * The `authenticate()` method returns a context module with methods that let
 * you ask questions about the authenticated account.
 */
export interface AuthContextModule<Modules extends {aws: AwsContextModule}> {
    /**
     * Tells us if the context is authenticated or not. If true then
     * `authenticate()` should succeed. If false then `authenticate()` will throw
     * an `UnauthenticatedError`.
     */
    isAuthenticated(): Promise<boolean>;

    /**
     * Parse this request's authentication credentials. If a request does not have
     * authenticated credentials or the credentials are incorrect, we throw
     * an `UnauthenticatedError`.
     *
     * Returns a context with an authenticated `auth` context module.
     */
    authenticate(): Promise<
        Context<Replace<Modules, {auth: AuthenticatedAuthContextModule<Modules>}>>
    >;
}

export class UnauthenticatedAuthContextModule<Modules extends {aws: AwsContextModule}>
    implements AuthContextModule<Modules>
{
    private readonly _context: Context<Modules>;
    private readonly _sessionPromise: Lazy<Promise<Session | null>>;

    constructor(context: Context<Modules>, getSession: () => Promise<Session | null>) {
        this._context = context;
        this._sessionPromise = new Lazy(getSession);
    }

    public async isAuthenticated(): Promise<boolean> {
        const session = await this._sessionPromise.get();
        return !!session;
    }

    public async authenticate() {
        const session = await this._sessionPromise.get();
        if (!session) throw unauthenticatedSessionError();

        return this._context.clone<{
            auth: AuthenticatedAuthContextModule<Modules>;
        }>({
            auth: context => new AuthenticatedAuthContextModule(context, session),
        });
    }
}

/**
 * Context module after we've successfully authenticated a user with our
 * service. Provides access to session information like the authenticated
 * account's ID.
 */
export class AuthenticatedAuthContextModule<Modules extends {aws: AwsContextModule}>
    implements AuthContextModule<Modules>
{
    constructor(
        private readonly _context: Context<
            Replace<Modules, {auth: AuthenticatedAuthContextModule<Modules>}>
        >,
        private readonly _session: Session,
    ) {}

    public async isAuthenticated() {
        return true;
    }

    public async authenticate() {
        return this._context;
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
