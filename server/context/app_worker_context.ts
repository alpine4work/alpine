import {RequestContext, UnauthenticatedRequestContext} from "~/server/context/context";
import {Account, Session} from "~/server/dynamo/accounts_table";
import {SessionCookie} from "~/server/session/session_cookie";
import {UnauthenticatedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Id} from "~/shared/id/id";

/**
 * Context for a request to our application Cloudflare Worker.
 *
 * The application Cloudflare Worker stores its session in a signed cookie. In
 * addition to `RequestContext` methods, this context also provides the ability
 * to modify the session cookie.
 */
export class UnauthenticatedAppWorkerRequestContext implements UnauthenticatedRequestContext {
    protected constructor(private readonly _state: UnauthenticatedAppWorkerRequestContextState) {}

    public static run(
        executionContext: ExecutionContext,
        request: Request,
        action: (context: UnauthenticatedAppWorkerRequestContext) => Promise<Response>,
    ): Promise<Response> {
        return SessionCookie.with(request, async sessionCookiePromise => {
            const state = new UnauthenticatedAppWorkerRequestContextState(
                executionContext,
                request,
                sessionCookiePromise,
            );
            const context = new UnauthenticatedAppWorkerRequestContext(state);
            try {
                const response = await action(context);
                return response;
            } finally {
                state.destroyAfterTasks();
            }
        });
    }

    public waitUntil(promise: Promise<void>): void {
        return this._state.waitUntil(promise);
    }

    public getClientIpAddress(): string | null {
        // We depend on Cloudflare to set the `cf-connecting-ip` header on our request
        // to get the IP address.
        // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
        return this._state.getRequest().headers.get("cf-connecting-ip");
    }

    public getClientUserAgent(): string | null {
        return this._state.getRequest().headers.get("user-agent");
    }

    private readonly _authenticatedContext = new Lazy<Promise<AppWorkerRequestContext>>(
        async () => {
            const sessionCookie = await this._state.getSessionCookie();
            const session = await Session.get(sessionCookie);

            if (!session) {
                throw new UnauthenticatedError("Unauthenticated session", {
                    displayMessage: errorDisplayMessage`You are not signed in. Please ${errorDisplayMessage.link(
                        "sign in",
                        "/sign-in",
                    )} and try again.`,
                });
            }

            return new AppWorkerRequestContext(this._state, session);
        },
    );

    public authenticate(): Promise<AppWorkerRequestContext> {
        return this._authenticatedContext.get();
    }

    public async getBrowserId() {
        const sessionCookie = await this._state.getSessionCookie();
        return sessionCookie.get().browserId;
    }

    public async dangerouslySetSessionId(sessionId: Id) {
        const sessionCookie = await this._state.getSessionCookie();
        sessionCookie.dangerouslySetSessionId(sessionId);
    }

    public async unsetSessionId() {
        const sessionCookie = await this._state.getSessionCookie();
        sessionCookie.unsetSessionId();
    }
}

/**
 * Context for a request to our application Cloudflare Worker.
 *
 * The application Cloudflare Worker stores its session in a signed cookie. In
 * addition to `RequestContext` methods, this context also provides the ability
 * to modify the session cookie.
 */
export class AppWorkerRequestContext
    extends UnauthenticatedAppWorkerRequestContext
    implements RequestContext
{
    constructor(
        state: UnauthenticatedAppWorkerRequestContextState,
        private readonly _session: Session,
    ) {
        super(state);
    }

    public override async authenticate(): Promise<AppWorkerRequestContext> {
        return this;
    }

    public getAuthenticatedAccountId(): Id {
        return this._session.accountId;
    }

    public getAuthenticatedAccount(): Promise<Account> {
        return this._session.getAccount();
    }
}

/**
 * Most of the context state is in this class so that we can share state across
 * different context child objects.
 */
class UnauthenticatedAppWorkerRequestContextState {
    private _executionContext: ExecutionContext | null;
    private _request: Request | null;
    private _sessionCookiePromise: Promise<SessionCookie> | null;

    private _isDestroyed = false;
    private _isDestroying = false;
    private _taskPromises: Array<Promise<void>> = [];

    constructor(
        executionContext: ExecutionContext,
        request: Request,
        sessionCookiePromise: Promise<SessionCookie>,
    ) {
        this._executionContext = executionContext;
        this._request = request;
        this._sessionCookiePromise = sessionCookiePromise;
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
        this._executionContext = null;
        this._request = null;
        this._sessionCookiePromise = null;
    }

    public waitUntil(promise: Promise<void>): void {
        assert(!this._isDestroyed && this._executionContext, "Request context destroyed");

        this._executionContext.waitUntil(promise);

        // We keep track of tasks our request is waiting on since we don't want to
        // destroy the request context until all tasks have completed. Since the task
        // may reference the request context.
        this._taskPromises.push(promise);
    }

    public getRequest() {
        assert(!this._isDestroyed && this._request, "Request context destroyed");
        return this._request;
    }

    public getSessionCookie() {
        assert(!this._isDestroyed && this._sessionCookiePromise, "Request context destroyed");
        return this._sessionCookiePromise;
    }
}
