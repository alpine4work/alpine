import {AwsClient} from "aws4fetch";
import {jwtVerify} from "jose";
import {
    ProcessContext,
    RequestContext,
    UnauthenticatedRequestContext,
} from "~/server/context/context";
import {createAwsClientFromEnv} from "~/server/context/helpers/create_aws_client_from_env";
import {unauthenticatedSessionError} from "~/server/context/helpers/unauthenticated_session_error";
import {Account, Session} from "~/server/dynamo/accounts_table";
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Id} from "~/shared/id/id";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";

export type DurableObjectEnv = {
    SESSION_COOKIE_SECRET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
};

export class DurableObjectProcessContext implements ProcessContext {
    private readonly _state: DurableObjectState;
    private readonly _sessionCookieSecret: string;
    public readonly awsClient: AwsClient;

    constructor(state: DurableObjectState, env: DurableObjectEnv) {
        this._state = state;

        const sessionCookieSecret =
            env.SESSION_COOKIE_SECRET ?? (process.env.NODE_ENV !== "production" ? "secret" : null);
        if (!sessionCookieSecret)
            throw new InternalError(
                "Environment variable `SESSION_COOKIE_SECRET` must be set in production",
            );

        this._sessionCookieSecret = sessionCookieSecret;

        this.awsClient = createAwsClientFromEnv(env);
    }

    public waitUntil(promise: Promise<void>): void {
        this._state.waitUntil(promise);
    }

    public async verifyAuthenticationToken(token: string): Promise<{sessionId: Id}> {
        const {payload} = await jwtVerify(
            token,
            new TextEncoder().encode(this._sessionCookieSecret),
        );
        const sessionId = Schema.id.deserialize(payload.sessionId as SchemaSerializedValue);

        return {sessionId};
    }
}

export class DurableObjectUnauthenticatedRequestContext implements UnauthenticatedRequestContext {
    public readonly awsClient: AwsClient;

    protected constructor(protected readonly _state: DurableObjectRequestContextState) {
        this.awsClient = this._state.getProcessContext().awsClient;
    }

    public static async run(
        processContext: DurableObjectProcessContext,
        request: Request,
        action: (context: DurableObjectUnauthenticatedRequestContext) => Promise<Response>,
    ): Promise<Response> {
        const state = new DurableObjectRequestContextState(processContext, request);
        const context = new DurableObjectUnauthenticatedRequestContext(state);
        try {
            const response = await action(context);
            return response;
        } finally {
            state.destroyAfterTasks();
        }
    }

    public waitUntil(promise: Promise<void>): void {
        this._state.waitUntil(promise);
    }

    public getClientIpAddress(): string | null {
        // TODO(calebmer): Figure out client info propagation. The IP address may be
        // the IP of the worker forwarding the request. Not the original client.
        return null;
    }

    public getClientUserAgent(): string | null {
        // TODO(calebmer): Figure out client info propagation. The user agent may be
        // the user agent of the worker forwarding the request. Not the original client.
        return null;
    }

    private readonly _authenticatedContext: Lazy<Promise<DurableObjectRequestContext | null>> =
        new Lazy(async () => {
            const request = this._state.getRequest();

            const authorizationHeader = request.headers.get("authorization");
            if (!authorizationHeader) return null;
            const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

            if (!authorizationHeaderMatch)
                throw new InvalidArgumentError(
                    'Expected "Authorization" header to have "Bearer" authentication scheme',
                );

            const authenticationToken = authorizationHeaderMatch[1] ?? "";

            const {sessionId} = await this._state
                .getProcessContext()
                .verifyAuthenticationToken(authenticationToken);

            const session = await Session.get(this, sessionId);
            if (!session)
                throw new NotFoundError('Could not find session from "Authorization" header');

            return new DurableObjectRequestContext(this._state, session);
        });

    public async isAuthenticated(): Promise<boolean> {
        const context = await this._authenticatedContext.get();
        return !!context;
    }

    public async authenticate(): Promise<DurableObjectRequestContext> {
        const context = await this._authenticatedContext.get();
        if (!context) throw unauthenticatedSessionError();
        return context;
    }

    /**
     * Get the underlying `DurableObjectProcessContext`. Use this when you need to
     * get a context that lives as long as the process.
     */
    public getProcessContext() {
        return this._state.getProcessContext();
    }
}

export class DurableObjectRequestContext
    extends DurableObjectUnauthenticatedRequestContext
    implements RequestContext
{
    constructor(state: DurableObjectRequestContextState, private readonly _session: Session) {
        super(state);
    }

    public override async authenticate(): Promise<DurableObjectRequestContext> {
        return this;
    }

    public getAuthenticatedAccountId(): Id {
        this._state.assertNotDestroyed();
        return this._session.accountId;
    }

    public getAuthenticatedAccount(): Promise<Account> {
        this._state.assertNotDestroyed();
        return this._session.getAccount(this);
    }

    public upgrade() {
        return new DurableObjectConnectionContext(this.getProcessContext(), this._session.id);
    }
}

class DurableObjectRequestContextState {
    private _processContext: DurableObjectProcessContext | null;
    private _request: Request | null;

    private _isDestroyed = false;
    private _isDestroying = false;
    private _taskPromises: Array<Promise<void>> = [];

    constructor(processContext: DurableObjectProcessContext, request: Request) {
        this._processContext = processContext;
        this._request = request;
    }

    public destroyAfterTasks() {
        assert(!this._isDestroyed, "Request context already destroyed");
        assert(!this._isDestroying, "Request context already waiting to be destroyed");
        this._isDestroying = true;

        // Wait for all our tasks to resolve before we can destroy this request promise.
        // The tasks may end up using the request promise.
        const loop = () => {
            const taskPromises = this._taskPromises;
            this._taskPromises = [];

            if (taskPromises.length === 0) {
                this._actuallyDestroy();
            } else {
                Promise.allSettled(taskPromises).finally(loop);
            }
        };

        loop();
    }

    private _actuallyDestroy() {
        assert(!this._isDestroyed, "Request context already destroyed");
        this._isDestroyed = true;
        this._processContext = null;
        this._request = null;
    }

    public assertNotDestroyed() {
        assert(!this._isDestroyed, "Request context already destroyed");
    }

    public waitUntil(promise: Promise<void>): void {
        assert(!this._isDestroyed && this._processContext, "Request context destroyed");

        this._processContext.waitUntil(promise);

        // We keep track of tasks our request is waiting on since we don't want to
        // destroy the request context until all tasks have completed. Since the task
        // may reference the request context.
        this._taskPromises.push(promise);
    }

    public getProcessContext() {
        assert(!this._isDestroyed && this._processContext, "Request context destroyed");
        return this._processContext;
    }

    public getRequest() {
        assert(!this._isDestroyed && this._request, "Request context destroyed");
        return this._request;
    }
}

export class DurableObjectConnectionContext {
    constructor(
        private readonly _processContext: ProcessContext,

        /**
         * Session id is a secret! It should be kept private. An attacker could use a
         * session id to impersonate other users.
         *
         * We put the session id in our connection context and not the full `Session`
         * object because we want to reload the `Session` object on every request.
         */
        private readonly _sessionId: Id,
    ) {}

    public async request(
        action: (context: DurableObjectConnectionRequestContext) => Promise<void>,
    ): Promise<void> {
        // TODO(calebmer): Can we at least give this some kind of TTL in-memory cache??
        const session = await Session.get(this._processContext, this._sessionId);
        if (!session) throw new NotFoundError("Session was deleted after the connection began");

        const context = new DurableObjectConnectionRequestContext(this._processContext, session);
        try {
            await action(context);
        } finally {
            context._destroyAfterTasks();
        }
    }
}

class DurableObjectConnectionRequestContext implements RequestContext {
    private _processContext: ProcessContext | null;
    private _session: Session | null;
    public readonly awsClient: AwsClient;

    constructor(processContext: ProcessContext, session: Session) {
        this._processContext = processContext;
        this._session = session;
        this.awsClient = this._processContext.awsClient;
    }

    private _isDestroyed = false;
    private _isDestroying = false;
    private _taskPromises: Array<Promise<void>> = [];

    // TODO(calebmer): I'm seeing a lot of duplicate code. This probably isn't the
    // best design...
    public _destroyAfterTasks() {
        assert(!this._isDestroyed, "Request context already destroyed");
        assert(!this._isDestroying, "Request context already waiting to be destroyed");
        this._isDestroying = true;

        // Wait for all our tasks to resolve before we can destroy this request promise.
        // The tasks may end up using the request promise.
        const loop = () => {
            const taskPromises = this._taskPromises;
            this._taskPromises = [];

            if (taskPromises.length === 0) {
                this._actuallyDestroy();
            } else {
                Promise.allSettled(taskPromises).finally(loop);
            }
        };

        loop();
    }

    private _actuallyDestroy() {
        assert(!this._isDestroyed, "Request context already destroyed");
        this._isDestroyed = true;
        this._processContext = null;
        this._session = null;
    }

    public waitUntil(promise: Promise<void>): void {
        assert(!this._isDestroyed && this._processContext, "Request context destroyed");

        this._processContext.waitUntil(promise);

        // We keep track of tasks our request is waiting on since we don't want to
        // destroy the request context until all tasks have completed. Since the task
        // may reference the request context.
        this._taskPromises.push(promise);
    }

    public getClientIpAddress(): string | null {
        // TODO(calebmer): Figure out client info propagation. The IP address may be
        // the IP of the worker forwarding the request. Not the original client.
        return null;
    }

    public getClientUserAgent(): string | null {
        // TODO(calebmer): Figure out client info propagation. The user agent may be
        // the user agent of the worker forwarding the request. Not the original client.
        return null;
    }

    public async isAuthenticated(): Promise<boolean> {
        return true;
    }

    public async authenticate(): Promise<DurableObjectConnectionRequestContext> {
        return this;
    }

    public getAuthenticatedAccountId(): Id {
        assert(!this._isDestroyed && this._session, "Request context already destroyed");
        return this._session.accountId;
    }

    public getAuthenticatedAccount(): Promise<Account> {
        assert(!this._isDestroyed && this._session, "Request context already destroyed");
        return this._session.getAccount(this);
    }
}
