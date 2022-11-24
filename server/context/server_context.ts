import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Object describing the context in which our server code executes.
 */
// NOTE(calebmer): I expect this to get more features over time. Including
// tracing and authentication.
export abstract class ServerContext {
    /**
     * Don't let the process exit until this promise has completed.
     *
     * Errors will be handled and attached to the execution trace.
     *
     * See the [Cloudflare documentation][1] for this method.
     *
     * [1]: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    // TODO(calebmer): Error handling! Unhandled exceptions should not crash
    // the process.
    public abstract waitUntil(promise: Promise<void>): void;

    /**
     * If this context is for an HTTP request, then this returns the IP address of
     * the client making the request.
     */
    public abstract getRequestIpAddress(): string | null;

    /**
     * If this context is for an HTTP request, then this returns the user agent of
     * the client making the request.
     */
    public abstract getRequestUserAgent(): string | null;
}

function getRequestIpAddress(request: Request): string | null {
    // https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
    return request.headers.get("cf-connecting-ip");
}

function getRequestUserAgent(request: Request): string | null {
    return request.headers.get("user-agent");
}

/**
 * Context for a request to a Cloudflare Worker.
 */
export class WorkerServerContext extends ServerContext {
    constructor(private readonly _request: Request, private readonly _context: ExecutionContext) {
        super();
    }

    public waitUntil(promise: Promise<void>): void {
        this._context.waitUntil(promise);
    }

    public getRequestIpAddress(): string | null {
        return getRequestIpAddress(this._request);
    }

    public getRequestUserAgent(): string | null {
        return getRequestUserAgent(this._request);
    }
}

/**
 * Context for a request to a Cloudflare Durable Object.
 */
export class DurableObjectRequestServerContext extends ServerContext {
    private readonly _requestIpAddress: string | null;
    private readonly _requestUserAgent: string | null;

    constructor(private readonly _state: DurableObjectState, request: Request) {
        super();
        // We extract headers we care about into properties so `request` can be garbage
        // collected. If this is a WebSocket, the request server context will be long
        // lived.
        this._requestIpAddress = getRequestIpAddress(request);
        this._requestUserAgent = getRequestUserAgent(request);
    }

    public waitUntil(promise: Promise<void>): void {
        this._state.waitUntil(promise);
    }

    public getRequestIpAddress(): string | null {
        return this._requestIpAddress;
    }

    public getRequestUserAgent(): string | null {
        return this._requestUserAgent;
    }
}

let jestAfterEachPromises: Array<Promise<void>> = [];

if (typeof jest !== "undefined") {
    afterEach(async () => {
        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    });
}

export class TestServerContext extends ServerContext {
    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `TestServerContext`s to resolve.
     */
    public static async waitForTasks() {
        assert(typeof jest !== "undefined");

        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    }

    constructor() {
        if (typeof jest === "undefined")
            throw new InternalError("May only construct a test server context in Jest tests");

        super();
    }

    public waitUntil(promise: Promise<void>): void {
        jestAfterEachPromises.push(promise);
    }

    public getRequestIpAddress() {
        return null;
    }

    public getRequestUserAgent() {
        return null;
    }
}
