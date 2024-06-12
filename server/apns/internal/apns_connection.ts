import {addDays} from "date-fns";
import fs from "node:fs";
import http2 from "node:http2";
import {join as joinPath} from "node:path";
import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/apns/apns_alert_notification.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {DeadlineExceededError, InternalError, UnavailableError} from "~/shared/error/error.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {convertIdIntoUuid} from "~/shared/id/convert_id_into_uuid.js";
import {generateId} from "~/shared/id/id.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";

const apnsTracerServiceName = "APNs";

/**
 * How frequently should we ping the HTTP/2 connection to let APNs know our
 * client is still alive?
 */
const pingIntervalMs = 5_000;

/**
 * If no data is returned for a request within this timeout then we'll end the
 * request and throw an error.
 */
const requestTimeoutMs = 10_000;

/**
 * Certificates for sending push notifications to the APNs sandbox. These
 * certificates are not accepted for production! They may only be used to
 * send notifications in development.
 *
 * These certificates expire within a year. To generate new certificates:
 *
 * 1. Create a certificate signing request with Keychain Access on MacOS. Go
 *    to Keychain Access > Certificate Assistant > Request a Certificate From
 *    a Certificate Authority. This will generate a `.certSigningRequest` file
 *    and a private key which will be accessible in Keychain Access.
 *
 * 2. Go to the Certificates, Identifiers & Profiles page in our Apple
 *    developer account.
 *
 * 3. Create a new certificate with the "Apple Sandbox Push Services" type.
 *    Generating a sandbox certificate is important! Do not generate a
 *    production certificate since you'll be committing this certificate to
 *    git.
 *
 * 4. Download the file and name it `apns_development.cer`. Double click the
 *    file to install it in Keychain Access.
 *
 * 5. Find the certificate in Keychain Access. In Keychain Access the
 *    certificate should have a child private key. Right click on the private
 *    key and export it as a `.p12` file. Name it `apns_development.p12`.
 *
 * 6. Create a certificate `.pem` file with:
 *    `openssl x509 -in apns_development.cer -out apns_development_cert.pem`
 *
 * 7. Create a key `.pem` file with:
 *    `openssl pkcs12 -in apns_development.p12 -out apns_development_key.pem -nocerts -nodes -legacy`
 */
// NOCOMMIT: This should come from constructor? Fine for now.
const apnsDevelopmentCert = fs.readFileSync(
    joinPath(runfilesPath, "cyberworlds/server/apns/certificates/apns_development_cert.pem"),
);

// NOCOMMIT: This should come from constructor? Fine for now.
const apnsDevelopmentKey = fs.readFileSync(
    joinPath(runfilesPath, "cyberworlds/server/apns/certificates/apns_development_key.pem"),
);

/**
 * An HTTP/2 connection to Apple Push Notification service (APNs). The APNs API
 * is documented in “[Sending notification requests to APNs][1]” and “[Handling
 * notification responses from APNs][2].”
 *
 * There are services like [AWS SNS][3] that provide a simple HTTP/1 interface
 * to send push notifications but it's not complicated (and saves us money and
 * reduces vendor lock in) to use Node.js HTTP/2 client to send notifications
 * ourselves. The downside is HTTP/2 clients have more state and edge cases to
 * deal with than an HTTP/1 client. Hence this class which properly handles
 * connection setup and errors.
 *
 * [1]: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 * [2]: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
 * [3]: https://aws.amazon.com/sns/
 */
// NOCOMMIT: Pool connection shutdown logic
// NOCOMMIT: Connection ID in tracer?
export class ApnsConnection {
    private readonly _processContext: ServerProcessContext;
    private readonly _session: http2.ClientHttp2Session;

    private _hasCloseError = false;
    private _closeError: unknown = undefined;
    private readonly _startClosePromiseResolver = createPromiseResolver();
    private readonly _endClosePromiseResolver = createPromiseResolver();

    private readonly _pingInterval: Interval;

    public static connect(
        processContext: ServerProcessContext,
        actionContext: ServerActionContext,
    ) {
        // Make sure `processContext` is actually a process context and doesn't
        // sneakily contain an actor.
        assert(!("actor" in processContext) && !("cache" in processContext));

        return actionContext.tracer.withSpan("Connecting to APNs", async (actionContext, span) => {
            span.addData({http: {service: {name: apnsTracerServiceName}}});

            const session = http2.connect(
                process.env.NODE_ENV === "production"
                    ? "https://api.push.apple.com:443"
                    : "https://api.sandbox.push.apple.com:443",
                {
                    key: apnsDevelopmentKey,
                    cert: apnsDevelopmentCert,
                },
            );

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

            return new ApnsConnection(processContext, session);
        });
    }

    private constructor(processContext: ServerProcessContext, session: http2.ClientHttp2Session) {
        this._processContext = processContext;
        this._session = session;

        this._pingInterval = createInterval(() => {
            const {span, finishSpan} = this._processContext.tracer
                .getRoot()
                .startSpan("Sending ping to APNs connection");

            span.addData({http: {service: {name: apnsTracerServiceName}}});

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
     * Resolves when the connection starts to close. Call `waitForClose()` if you
     * want to wait for the connection to actually close.
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
     * Close the connection. Returns a promise that resolves once the connection
     * has successfully closed (the same promise returned by `waitForClose()`).
     */
    public close(): Promise<void> {
        if (this._startClosePromiseResolver.isSettled())
            return this._endClosePromiseResolver.promise;

        this._pingInterval.clear();

        this._startClosePromiseResolver.resolve();

        const {span, finishSpan} = this._processContext.tracer
            .getRoot()
            .startSpan("Closing APNs connection");

        span.addData({http: {service: {name: apnsTracerServiceName}}});

        // Finish the span after we've finished closing.
        void this._endClosePromiseResolver.promise.finally(finishSpan);

        this._session.close();

        return this._endClosePromiseResolver.promise;
    }

    private _closeWithError(error: unknown) {
        // If we've already started closing, still log the error to our telemetry
        // provider but we don't need to run the `close()` function again.
        if (this._startClosePromiseResolver.isSettled()) {
            this._processContext.tracer
                .getRoot()
                .logUncaughtException("Already closed APNs connection", error, {
                    http: {service: {name: apnsTracerServiceName}},
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

        span.addData({http: {service: {name: apnsTracerServiceName}}});

        span.addException(error);

        // Finish the span after we've finished closing.
        void this._endClosePromiseResolver.promise.finally(finishSpan);

        this._session.close();
    }

    private readonly _handleClose = () => {
        // We've already closed.
        if (this._endClosePromiseResolver.isSettled()) return;

        this._pingInterval.clear();

        // If we were closed by `close()` or `_closeWithError()` then this is an
        // expected close event. If the HTTP/2 client closed on its own this is an
        // unexpected close event and we should log an error.
        const wasCloseExpected = this._startClosePromiseResolver.isSettled();

        if (!wasCloseExpected && !this._hasCloseError) {
            this._hasCloseError = true;
            this._closeError = new UnavailableError("Connection closed unexpectedly");

            const {span, finishSpan} = this._processContext.tracer
                .getRoot()
                .startSpan("Closing APNs connection");

            span.addData({http: {service: {name: apnsTracerServiceName}}});

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

    private readonly _handleGoaway = (
        errorCode: number,
        lastStreamId: number,
        opaqueData: Buffer,
    ) => {
        // TODO(calebmer): According to [Apple's documentation][1], `opaqueData` will
        // be a JSON object with a `reason` string with more information. We should
        // consider parsing this JSON object and including it in the error.
        //
        // [1]: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns#Understand-error-codes
        this._closeWithError(
            new UnavailableError(`Received GOAWAY frame (error code: ${errorCode})`),
        );
    };

    private readonly _handleFrameError = (type: number, errorCode: number, streamId: number) => {
        this._closeWithError(
            new InternalError(`Failed to send frame (type: ${type}, error code: ${errorCode})`),
        );
    };

    /**
     * Send a push notification to the provided Apple device token.
     *
     * For more information on supported properties on a notification object
     * see “[Generating a remove notification][1]”.
     *
     * [1]: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
     */
    public sendAlert(
        context: ServerActionContext,
        deviceToken: Uint8Array,
        notification: ApnsAlertNotification,
        {
            id = generateId(),
            expirationTime = addDays(new Date(), 5),
            priority = 10,
            collapseId,
        }: ApnsAlertNotificationOptions = {},
    ) {
        return context.tracer.withSpan("Sending APNs alert notification", async (context, span) => {
            if (this._startClosePromiseResolver.isSettled())
                throw new InternalError("Connection is closed");

            assert(deviceToken.byteLength === 32);

            const deviceTokenString = Array.from(deviceToken, byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");

            const requestHeaders = {
                "apns-push-type": "alert",
                "apns-id": convertIdIntoUuid(id),
                "apns-expiration": expirationTime
                    ? String(Math.floor(expirationTime.getTime() / 1000))
                    : undefined,
                "apns-priority": String(priority),
                "apns-topic": "inc.alpine.mobile.app",
                "apns-collapse-id": collapseId,
            };

            const request = this._session.request({
                ...requestHeaders,
                ":method": "POST",
                ":path": `/3/device/${deviceTokenString}`,
            });

            span.addData({
                http: {
                    service: {name: apnsTracerServiceName},
                    route: "/3/device/:deviceToken",
                    method: "POST",
                    request: {
                        header: Object.fromEntries(
                            filterIterable(Object.entries(requestHeaders), ([headerName]) =>
                                tracerEventHttpHeaderNames.has(headerName),
                            ),
                        ),
                    },
                },
            });

            const response = await new Promise<{
                headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader;
                body: Buffer;
            }>((resolve, reject) => {
                request.setTimeout(requestTimeoutMs, () => {
                    request.close(http2.constants.NGHTTP2_CANCEL);
                    reject(new DeadlineExceededError("Request timed out"));
                });

                let headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader = {};
                const bodyChunks: Array<Buffer> = [];

                request.on("response", newHeaders => (headers = newHeaders));
                request.on("data", bodyChunk => bodyChunks.push(bodyChunk));
                request.on("end", () => resolve({headers, body: Buffer.concat(bodyChunks)}));
                request.on("error", reject);

                request.write(JSON.stringify(notification));
                request.end();
            });

            const statusCode = response.headers[":status"];
            if (statusCode === undefined) throw new InternalError("Missing status code");

            span.addData({
                http: {
                    statusCode,
                    response: {
                        header: Object.fromEntries(
                            filterIterable(Object.entries(response.headers), ([headerName]) =>
                                tracerEventHttpHeaderNames.has(headerName),
                            ),
                        ),
                    },
                },
            });
        });
    }
}
