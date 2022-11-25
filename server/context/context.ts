/*!
 * We don't rely on implicit global propagation in our codebase. Instead when
 * there is context we want to pass around we use a context object. That way
 * the capabilities of what you can do at a given point in the code are made
 * clear by the types.
 *
 * We have a couple context interfaces that are implemented by actual classes.
 */

import {Account} from "~/server/dynamo/accounts_table";
import {Id} from "~/shared/id/id";

/**
 * This context provides information about the process our code is running in
 * and allows extending the lifetime of the process for code running in
 * serverless-like environments (e.g. Cloudflare Workers and Cloudflare
 * Durable Objects).
 */
export interface ProcessContext {
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
    waitUntil(promise: Promise<void>): void;
}

/**
 * This context is constructed whenever we are running some code on behalf of a
 * client. Contains identifying information about that client.
 *
 * We could be running a request the client expects to return instantly, we
 * could have an open WebSocket connection to the client, or we could be
 * processing some task asynchronously for a client.
 */
export interface ClientContext extends ProcessContext {
    /**
     * The IP address of the original client which initiated this context.
     *
     * Even when we are many service layers deep, we expect this IP address to be
     * the client of the original browser to call into our services.
     */
    // TODO(calebmer): Come up with some propagation format for this info. We also
    // probably want to record other info Cloudflare gives us like connecting
    // country?
    getClientIpAddress(): string | null;

    /**
     * The user agent of the original client which initiated this context.
     *
     * Even when we are many service layers deep, we expect this IP address to be
     * the client of the original browser to call into our services.
     */
    getClientUserAgent(): string | null;
}

/**
 * Context for a request against our services. Requests are expected to
 * complete as soon as possible and return a response.
 *
 * Most of the time you will be using a `RequestContext`, which is the same
 * but with information about the account accessing our service.
 *
 * Implementations of this class are recommended to destroy the context once
 * the request is done. Preventing any method from being called on the
 * destroyed context.
 */
export interface UnauthenticatedRequestContext extends ClientContext {
    /**
     * Parse this request's authentication credentials. If a request does not have
     * authenticated credentials or the credentials are incorrect, we throw
     * an `UnauthenticatedError`.
     */
    authenticate(): Promise<RequestContext>;
}

/**
 * Context for a request against our services. Requests are expected to
 * complete as soon as possible and return a response.
 *
 * See `UnauthenticatedRequestContext` for a version of this context without
 * information about the connected account.
 */
export interface RequestContext extends UnauthenticatedRequestContext {
    /**
     * What is the ID of the account connected to our service? Returns the same ID
     * as `getAccount()` but without loading the account from the database.
     */
    getAuthenticatedAccountId(): Id;

    /**
     * Returns the account connected to our service.
     */
    getAuthenticatedAccount(): Promise<Account>;
}
