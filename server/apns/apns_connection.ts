import {addDays} from "date-fns";
import http2 from "node:http2";
import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/context/apns_alert_notification.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    DeadlineExceededError,
    InternalError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {convertIdIntoUuid} from "~/shared/id/convert_id_into_uuid.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ApnsConnectionId} from "~/shared/id/types/id_types.js";
import {getHeadersTracerData} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

const apnsHostname =
    process.env.NODE_ENV === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";

const apnsPort = "443";

/**
 * How frequently should we ping the HTTP/2 connection to let APNs know our client
 * is still alive?
 */
const pingIntervalMs = 5_000;

/**
 * If no data is returned for a request within this timeout then we'll end the
 * request and throw an error.
 */
const requestTimeoutMs = 10_000;

/**
 * An HTTP/2 connection to Apple Push Notification service (APNs). The APNs API is
 * documented in "[Sending notification requests to APNs][1]" and "[Handling
 * notification responses from APNs][2]."
 *
 * There are services like [AWS SNS][3] that provide a simple HTTP/1 interface to
 * send push notifications but it's not complicated (and saves us money and reduces
 * vendor lock in) to use Node.js HTTP/2 client to send notifications ourselves.
 * The downside is HTTP/2 clients have more state and edge cases to deal with than
 * an HTTP/1 client. Hence this class which properly handles connection setup and
 * errors.
 *
 * # Certificates
 *
 * You must pass in certificates in PEM format (the `certificate` option and
 * `certificatePrivateKey` option) generated from our Apple developer account so we
 * can properly authenticate with APNs.
 *
 * We have development certificates in `server/apns/certificates` that work in the
 * APNs sandbox but will not work in production!
 *
 * These certificates expire within a year. To generate new certificates:
 *
 * 1. Create a certificate signing request with Keychain Access on MacOS. Go to
 *    Keychain Access > Certificate Assistant > Request a Certificate From a
 *    Certificate Authority. This will generate a `.certSigningRequest` file and a
 *    private key which will be accessible in Keychain Access.
 *
 * 2. Go to the Certificates, Identifiers & Profiles page in our Apple developer
 *    account.
 *
 * 3. Create a new certificate with the "Apple Sandbox Push Services" type.
 *    Generating a sandbox certificate is important! Do not generate a production
 *    certificate since you'll be committing this certificate to git.
 *
 * 4. Download the file and name it `aps_development.cer`. Double click the file to
 *    install it in Keychain Access.
 *
 * 5. Find the certificate in Keychain Access. In Keychain Access the certificate
 *    should have a child private key. Right click on the private key and export it
 *    as a `.p12` file. Name it `aps_development.p12`.
 *
 * 6. Create a certificate `.pem` file with:
 *    `openssl x509 -in aps_development.cer -out apns_development_certificate.pem`
 *
 * 7. Create a key `.pem` file with:
 *    `openssl pkcs12 -in aps_development.p12 -out apns_development_certificate_private_key.pem -nocerts -nodes -legacy`
 *
 * [1]:
 *     https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 * [2]:
 *     https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
 * [3]: https://aws.amazon.com/sns/
 */
export class ApnsConnection {
    private readonly _id: ApnsConnectionId;
    private readonly _processContext: Context<{tracer: TracerContextModule}>;
    private readonly _session: http2.ClientHttp2Session;

    private _hasCloseError = false;
    private _closeError: unknown = undefined;
    private readonly _startClosePromiseResolver = createPromiseResolver();
    private readonly _endClosePromiseResolver = createPromiseResolver();

    private readonly _pingInterval: Interval;

    public static connect(
        processContext: Context<{tracer: TracerContextModule}>,
        actionContext: ServerActionContext,
        {certificate, certificatePrivateKey}: {certificate: string; certificatePrivateKey: string},
    ) {
        // Make sure `processContext` is actually a process context and doesn't sneakily
        // contain an actor.
        assert(!("actor" in processContext) && !("cache" in processContext));

        return actionContext.tracer.withSpan("Connecting to APNs", async (actionContext, span) => {
            const id = generateId<ApnsConnectionId>();

            span.addData({apns: {connectionId: id}});

            const session = http2.connect(`https://${apnsHostname}:${apnsPort}`, {
                cert: certificate,
                key: certificatePrivateKey,
            });

            await new Promise<void>((resolve, reject) => {
                const handleConnect = () => {
                    session.off("connect", handleConnect);
                    session.off("error", handleError);

                    resolve();
                };

                const handleError = (error: unknown) => {
                    session.off("connect", handleConnect);
                    session.off("error", handleError);

                    reject(error);
                };

                session.on("connect", handleConnect);
                session.on("error", handleError);
            });

            return new ApnsConnection(id, processContext, session);
        });
    }

    private constructor(
        id: ApnsConnectionId,
        processContext: Context<{tracer: TracerContextModule}>,
        session: http2.ClientHttp2Session,
    ) {
        this._id = id;
        this._processContext = processContext;
        this._session = session;

        this._pingInterval = createInterval(() => {
            const {span, finishSpan} = this._processContext.tracer
                .getRoot()
                .startSpan("Sending ping to APNs connection");

            span.addData({apns: {connectionId: this._id}});

            this._session.ping(error => {
                if (error) span.addException(error);
                finishSpan();
            });
        }, pingIntervalMs);

        this._session.on("close", this._handleClose);
        this._session.on("error", this._handleError);
        this._session.on("goaway", this._handleGoaway);
        this._session.on("frameError", this._handleFrameError);
    }

    /**
     * Resolves when the connection starts to close. Call `waitForClose()` if you want
     * to wait for the connection to actually close.
     *
     * Throws an error if the connection closed with an error.
     */
    public waitForCloseStart(): Promise<void> {
        return this._startClosePromiseResolver.promise;
    }

    /**
     * Resolves when the connection has closed.
     *
     * Throws an error if the connection closed with an error.
     */
    public waitForClose(): Promise<void> {
        return this._endClosePromiseResolver.promise;
    }

    /**
     * Close the connection. Returns a promise that resolves once the connection has
     * successfully closed (the same promise returned by `waitForClose()`).
     */
    public close(tracer: TracerBase): Promise<void> {
        if (this._startClosePromiseResolver.isSettled())
            return this._endClosePromiseResolver.promise;

        this._pingInterval.clear();

        this._startClosePromiseResolver.resolve();

        const {span, finishSpan} = tracer.startSpan("Closing APNs connection");

        span.addData({apns: {connectionId: this._id}});

        // Finish the span after we've finished closing.
        void this._endClosePromiseResolver.promise.finally(finishSpan);

        this._session.close();

        return this._endClosePromiseResolver.promise;
    }

    private _closeWithError(error: unknown) {
        // If we've already started closing, still log the error to our telemetry provider
        // but we don't need to run the `close()` function again.
        if (this._startClosePromiseResolver.isSettled()) {
            this._processContext.tracer
                .getRoot()
                .logException("Already closed APNs connection", error, {
                    apns: {connectionId: this._id},
                });
            return;
        }

        this._pingInterval.clear();

        this._hasCloseError = true;
        this._closeError = error;

        this._startClosePromiseResolver.reject(error);

        const {span, finishSpan} = this._processContext.tracer
            .getRoot()
            .startSpan("Closing APNs connection");

        span.addData({apns: {connectionId: this._id}});

        span.addException(error);

        // Finish the span after we've finished closing.
        void this._endClosePromiseResolver.promise.finally(finishSpan);

        this._session.close();
    }

    private readonly _handleClose = () => {
        // We've already closed.
        if (this._endClosePromiseResolver.isSettled()) return;

        this._pingInterval.clear();

        // If we were closed by `close()` or `_closeWithError()` then this is an expected
        // close event. If the HTTP/2 client closed on its own this is an unexpected close
        // event and we should log an error.
        const wasCloseExpected = this._startClosePromiseResolver.isSettled();

        if (!wasCloseExpected && !this._hasCloseError) {
            this._hasCloseError = true;
            this._closeError = new UnavailableError("APNs connection closed unexpectedly");

            const {span, finishSpan} = this._processContext.tracer
                .getRoot()
                .startSpan("Closing APNs connection");

            span.addData({apns: {connectionId: this._id}});

            span.addException(this._closeError);

            finishSpan();
        }

        if (this._hasCloseError) {
            if (!wasCloseExpected) this._startClosePromiseResolver.reject(this._closeError);
            this._endClosePromiseResolver.reject(this._closeError);
        } else {
            if (!wasCloseExpected) this._startClosePromiseResolver.resolve();
            this._endClosePromiseResolver.resolve();
        }
    };

    private readonly _handleError = (error: unknown) => {
        this._closeWithError(error);
    };

    private readonly _handleGoaway = (errorCode: number) => {
        // TODO(calebmer): According to [Apple's documentation][1], `opaqueData` will be a
        // JSON object with a `reason` string with more information. We should consider
        // parsing this JSON object and including it in the error.
        //
        // [1]:
        //     https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns#Understand-error-codes
        this._closeWithError(
            new UnavailableError(`Received GOAWAY frame from APNs (error code: ${errorCode})`),
        );
    };

    private readonly _handleFrameError = (type: number, errorCode: number) => {
        this._closeWithError(
            new InternalError(
                `Failed to send frame to APNs (type: ${type}, error code: ${errorCode})`,
            ),
        );
    };

    /**
     * Send a push notification to the provided Apple device token.
     *
     * For more information on supported properties on a notification object see
     * "[Generating a remove notification][1]".
     *
     * If this function returns `wasDeviceTokenUnregistered` then you should delete the
     * provided device token from the database to avoid sending notifications to it
     * again.
     *
     * [1]:
     *     https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
     */
    public sendAlert(
        context: ServerActionContext,
        deviceToken: Uint8Array,
        notification: ApnsAlertNotification,
        {
            id,
            expirationTime = addDays(new Date(), 28),
            priority = 10,
            collapseId,
        }: ApnsAlertNotificationOptions = {},
    ): Promise<{wasDeviceTokenUnregistered: boolean}> {
        return context.tracer.withSpan("Sending APNs alert notification", async (context, span) => {
            if (this._startClosePromiseResolver.isSettled())
                throw new InternalError("APNs connection is closed");

            assert(deviceToken.byteLength === 32);

            const deviceTokenString = Array.from(deviceToken, byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");

            const requestHeaders = {
                "apns-push-type": "alert",
                "apns-id": id ? convertIdIntoUuid(id) : undefined,
                "apns-expiration": expirationTime
                    ? String(Math.floor(expirationTime.getTime() / 1000))
                    : undefined,
                "apns-priority": String(priority),
                "apns-topic":
                    process.env.NODE_ENV === "production"
                        ? "inc.alpine.mobile.app"
                        : "dev.cyberworlds.mobile.app",
                "apns-collapse-id": collapseId,
            };

            const request = this._session.request({
                ...requestHeaders,
                ":method": "POST",
                ":path": `/3/device/${deviceTokenString}`,
            });

            span.addData({
                net: {sock: {peer: {name: apnsHostname, port: apnsPort}}},
                http: {
                    service: {name: "APNs"},
                    // IMPORTANT: Don't include the full URL! `deviceToken`s are sensitive data and
                    // should not be logged to telemetry. If an attacker got access to a `deviceToken`
                    // they may be able to send the device arbitrary push notifications if they also
                    // get access on our APNs private key.
                    route: "/3/device/:deviceToken",
                    method: "POST",
                    request: {
                        header: getHeadersTracerData(Object.entries(requestHeaders)),
                    },
                },
            });

            const response = await new Promise<{
                headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader;
                body: Buffer;
            }>((resolve, reject) => {
                request.setTimeout(requestTimeoutMs, () => {
                    request.close(http2.constants.NGHTTP2_CANCEL);
                    reject(new DeadlineExceededError("APNs request timed out"));
                });

                let headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader = {};
                const bodyChunks: Array<Uint8Array> = [];

                request.on("response", newHeaders => (headers = newHeaders));
                request.on("data", bodyChunk => bodyChunks.push(bodyChunk));
                request.on("end", () => resolve({headers, body: Buffer.concat(bodyChunks)}));
                request.on("error", reject);

                request.write(JSON.stringify(notification));
                request.end();
            });

            const statusCode = response.headers[":status"];
            if (statusCode === undefined)
                throw new InternalError("APNs request is missing status code");

            const body: {reason: string} | null =
                statusCode !== 200 ? JSON.parse(response.body.toString()) : null;

            span.addData({
                http: {
                    statusCode,
                    response: {
                        header: getHeadersTracerData(Object.entries(response.headers)),
                    },
                },
                apns: {
                    errorReason:
                        statusCode !== 200 && typeof body?.reason === "string"
                            ? body.reason
                            : undefined,
                },
            });

            const wasDeviceTokenUnregistered: boolean =
                statusCode !== 200 && body?.reason === "Unregistered";

            if (!wasDeviceTokenUnregistered && statusCode !== 200) {
                const errorMessage = getApnsErrorMessageFromStatusCode(statusCode);

                throw new (errorMessage !== null ? InternalError : UnknownError)(
                    `APNs request failed${
                        errorMessage !== null ? `: ${errorMessage}` : ""
                    } (status code: ${statusCode}${
                        body?.reason ? `, reason: ${quote(body.reason)}` : ""
                    })`,
                );
            }

            return {wasDeviceTokenUnregistered};
        });
    }
}

/**
 * Get a human readable error message based on the status code returned by APNs.
 * APNs status codes are documented [here][1].
 *
 * [1]:
 *     https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns#Interpret-header-responses
 */
function getApnsErrorMessageFromStatusCode(statusCode: number) {
    switch (statusCode) {
        case 400:
            return "Bad request";
        case 403:
            return "There was an error with the certificate or with the provider\u2019s authentication token";
        case 404:
            return "The request contained an invalid `:path` value";
        case 405:
            return "The request used an invalid `:method` value, only `POST` requests are supported";
        case 410:
            return "The device token is no longer active for the topic";
        case 413:
            return "The notification payload was too large";
        case 429:
            return "The server received too many requests for the same device token";
        case 500:
            return "Internal server error";
        case 503:
            return "The server is shutting down and unavailable";
        default:
            return null;
    }
}
