import {ApnsConnection} from "~/server/apns/apns_connection.js";
import {
    ApnsAlertNotification,
    ApnsAlertNotificationOptions,
} from "~/server/context/apns_alert_notification.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * The maximum number of connections we create in our pool.
 */
const maxConnectionCount = 5;

/**
 * The maximum number of concurrent requests before a connection is "saturated".
 *
 * After saturating a connection, we start making requests against the next
 * connection in the pool. If we haven't reached `maxConnectionCount` then we'll
 * create a new connection once our connection has been saturated.
 *
 * Once all connections have been saturated and we can't create new connections
 * we'll send requests to our existing connections in round robin format.
 */
const saturatedRequestCount = 3;

/**
 * Interval at which we check for idle connections. When the interval runs, we mark
 * all connection as idle. If a connection processes a request then it will be
 * unmarked as idle. If a connection hasn't been unmarked by the time our interval
 * runs again then the connection will be closed.
 */
const idleIntervalMs = 3 * 60 * 1000;

type ApnsConnectionPoolConnection = {
    readonly promise: Promise<ApnsConnection>;
    requestCount: number;
    isIdle: boolean;
};

/**
 * Maintains a pool of HTTP/2 connections to Apple Push Notification service
 * (APNs). When you make a request (like calling `sendAlert()`) we either: pick an
 * existing connection (using round-robin load balancing) or create a new
 * connection if our existing connections are busy. If any connection isn't used
 * for a while, we'll close the connection and create a new one if a new request
 * comes in.
 */
export class ApnsConnectionPool {
    private readonly _processContext: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
    }>;
    private readonly _certificate: string;
    private readonly _certificatePrivateKey: string;

    private _isDestroyed = false;
    private readonly _idleInterval: Interval;

    private _nextConnectionIndex = -1;
    private _connections: Array<ApnsConnectionPoolConnection> = [];

    constructor(
        processContext: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
        }>,
        {certificate, certificatePrivateKey}: {certificate: string; certificatePrivateKey: string},
    ) {
        this._processContext = processContext;
        this._certificate = certificate;
        this._certificatePrivateKey = certificatePrivateKey;

        this._idleInterval = createInterval(() => {
            void this._processContext.tracer.withSpan(
                "Expiring idle APNs connections",
                async (context, span) => {
                    // Don't send this span if a connection wasn't closed. If a connection is closed
                    // then we'll send a "close" event which references the parent span. If a
                    // connection is not closed then this span will have no references.
                    span.setWillNotSendIfNotReferenced(true);

                    // Close any connections that haven't had a request since our last interval run.
                    for (
                        let connectionIndex = 0;
                        connectionIndex < this._connections.length;
                        connectionIndex++
                    ) {
                        const connection = this._connections[connectionIndex]!;

                        if (!connection.isIdle) {
                            connection.isIdle = true;
                        } else {
                            context.process.waitUntil(async () => {
                                const actualConnection = await connection.promise;
                                await actualConnection.close(span);
                            });
                        }
                    }
                },
            );
        }, idleIntervalMs);
    }

    /**
     * Destroy the connection pool and close all connections in it. Will only return
     * once connections have successfully closed which means requests made by each
     * connection must successfully close.
     */
    public async destroy(tracer: TracerBase) {
        assert(!this._isDestroyed);
        this._isDestroyed = true;

        this._idleInterval.clear();

        const closePromises = this._connections.map(async connection => {
            const actualConnection = await connection.promise;
            await actualConnection.close(tracer);
        });

        await runAllPromises(closePromises);
    }

    private _createConnection(
        context: ServerActionContext,
        afterConnectionIndex: number,
    ): ApnsConnectionPoolConnection {
        assert(!this._isDestroyed);

        const connection: ApnsConnectionPoolConnection = {
            promise: ApnsConnection.connect(this._processContext, context, {
                certificate: this._certificate,
                certificatePrivateKey: this._certificatePrivateKey,
            }),
            requestCount: 0,
            isIdle: false,
        };

        this._connections.splice(afterConnectionIndex + 1, 0, connection);

        this._nextConnectionIndex = this._connections.findIndex(
            otherConnection => otherConnection === connection,
        );

        const remove = () => {
            const connectionIndex = this._connections.findIndex(
                otherConnection => otherConnection === connection,
            );

            if (connectionIndex === -1) return;

            this._connections.splice(connectionIndex, 1);

            // Update `nextConnectionIndex` if we're removing a connection that comes before
            // it. Wrap around to the last connection if we're deleting the first connection.
            if (this._nextConnectionIndex >= connectionIndex) {
                this._nextConnectionIndex =
                    this._nextConnectionIndex - 1 >= 0
                        ? this._nextConnectionIndex - 1
                        : this._connections.length - 1;
            }
        };

        // Remove the connection from our pool if it closes or if there was an error.
        connection.promise.then(actualConnection => {
            // Remove the connection from our pool immediately as the connection begins to
            // close since the connection won't be usable once closing starts.
            actualConnection.waitForCloseStart().then(remove, remove);
        }, remove);

        return connection;
    }

    private _getNextConnection(context: ServerActionContext): ApnsConnectionPoolConnection {
        assert(!this._isDestroyed);

        if (this._connections.length === 0) {
            return this._createConnection(context, -1);
        }

        let connectionIndex = this._nextConnectionIndex;
        let connection = this._connections[this._nextConnectionIndex]!;

        // Starting at `_nextConnectionIndex`, use the first connection which hasn't maxed
        // out its request count.
        for (let i = 0; i < this._connections.length; i++) {
            const attemptConnectionIndex =
                (this._nextConnectionIndex + i) % this._connections.length;
            const attemptConnection = this._connections[attemptConnectionIndex]!;

            if (attemptConnection.requestCount < saturatedRequestCount) {
                connectionIndex = attemptConnectionIndex;
                connection = attemptConnection;
                break;
            }
        }

        // If we did a full loop of our connections and they all had max requests, then
        // let's create a new connection if we haven't maxed out our connections yet.
        if (
            connection.requestCount >= saturatedRequestCount &&
            this._connections.length < maxConnectionCount
        ) {
            return this._createConnection(context, connectionIndex);
        }

        return connection;
    }

    /**
     * Get a connection to perform a request against. Let's look at an example of how
     * load balancing should work.
     *
     * Let's say `maxConnectionCount` is 5 and `saturatedRequestCount` is 3. Then we'll
     * send 22 notifications at the same time. So no notification finishes before
     * another starts. We should get the following:
     *
     * 1. Send notification 1
     *     - **Create connection A**
     *     - Send notification 1 via connection A
     * 2. Send notification 2
     *     - Send notification 2 via connection A
     * 3. Send notification 3
     *     - Send notification 3 via connection A
     * 4. Send notification 4
     *     - **Create connection B**
     *     - Send notification 4 via connection B
     * 5. Send notification 5
     *     - Send notification 5 via connection B
     * 6. Send notification 6
     *     - Send notification 6 via connection B
     * 7. Send notification 7
     *     - **Create connection C**
     *     - Send notification 7 via connection C
     * 8. Send notification 8
     *     - Send notification 8 via connection C
     * 9. Send notification 9
     *     - Send notification 9 via connection C
     * 10. Send notification 10
     *
     * - **Create connection D**
     * - Send notification 10 via connection D
     *
     * 11. Send notification 11
     *
     * - Send notification 11 via connection D
     *
     * 12. Send notification 12
     *
     * - Send notification 12 via connection D
     *
     * 13. Send notification 13
     *
     * - **Create connection E**
     * - Send notification 13 via connection E
     *
     * 14. Send notification 14
     *
     * - Send notification 14 via connection E
     *
     * 15. Send notification 15
     *
     * - Send notification 15 via connection E
     *
     * 16. Send notification 16
     *
     * - Send notification 16 via connection A
     *
     * 17. Send notification 17
     *
     * - Send notification 17 via connection B
     *
     * 18. Send notification 18
     *
     * - Send notification 18 via connection C
     *
     * 19. Send notification 19
     *
     * - Send notification 19 via connection D
     *
     * 20. Send notification 20
     *
     * - Send notification 20 via connection E
     *
     * 21. Send notification 21
     *
     * - Send notification 21 via connection A
     *
     * 22. Send notification 22
     *
     * - Send notification 22 via connection B
     *
     * We create connections at notification 1, 4, 7, 10, and 13. Every 3 notifications
     * we create a new connection (which is configured by `saturatedRequestCount`).
     * However, once we reach 5 connections (configured by `maxConnectionCount`) we
     * stop creating new connections and instead distribute requests round robin across
     * existing connections.
     */
    private async _withConnection<Value>(
        context: ServerActionContext,
        action: (connection: ApnsConnection) => Promise<Value>,
    ): Promise<Value> {
        const connection = this._getNextConnection(context);

        connection.requestCount += 1;
        connection.isIdle = false;

        // If this connection is processing the maximum number of requests, then next time
        // we process a request we should use the next connection in the pool.
        if (
            connection.requestCount >= saturatedRequestCount &&
            // If we haven't filled our pool with connections yet, then `getNextConnection()`
            // will create a new connection when we call it next so don't increment
            // `nextConnectionIndex`.
            !(this._connections.length < maxConnectionCount)
        ) {
            const connectionIndex = this._connections.findIndex(
                otherConnection => otherConnection === connection,
            );

            if (connectionIndex !== -1) {
                this._nextConnectionIndex =
                    connectionIndex + 1 < this._connections.length ? connectionIndex + 1 : 0;
            }
        }

        try {
            const actualConnection = await connection.promise;

            // Important that we `await` the action so the `finally` runs after the promise
            // completes.
            const value = await action(actualConnection);

            return value;
        } finally {
            connection.requestCount -= 1;
        }
    }

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
        options?: ApnsAlertNotificationOptions,
    ): Promise<{wasDeviceTokenUnregistered: boolean}> {
        return this._withConnection(context, connection =>
            connection.sendAlert(context, deviceToken, notification, options),
        );
    }

    /**
     * Provides a `sendAlert()` function to the action that does the same thing as our
     * class's `sendAlert()` function. If we don't have an APNs connection yet then
     * we'll connect in parallel with the action so if the action starts with any data
     * loading we can connect to APNs in parallel with that.
     *
     * For the duration of the action we will use the same APNs connection.
     *
     * Use this function as an optimization when you want to connect to APNs in
     * parallel with some other work.
     *
     * If the `sendAlert()` function returns `wasDeviceTokenUnregistered` then you
     * should delete the provided device token from the database to avoid sending
     * notifications to it again.
     */
    public async withSendAlert<Value>(
        context: ServerActionContext,
        action: (
            sendAlert: (
                deviceToken: Uint8Array,
                notification: ApnsAlertNotification,
                options?: ApnsAlertNotificationOptions,
            ) => Promise<{wasDeviceTokenUnregistered: boolean}>,
        ) => Promise<Value>,
    ): Promise<Value> {
        const connectionPromiseResolver = createPromiseResolver<ApnsConnection>();

        const sendAlert = async (
            deviceToken: Uint8Array,
            notification: ApnsAlertNotification,
            options?: ApnsAlertNotificationOptions,
        ) => {
            const connection = await connectionPromiseResolver.promise;
            return await connection.sendAlert(context, deviceToken, notification, options);
        };

        const actionPromise = action(sendAlert);

        const [value] = await runAllPromises([
            actionPromise,
            this._withConnection(context, connection => {
                connectionPromiseResolver.resolve(connection);

                return actionPromise.catch(() => {
                    // Don't throw any errors here. Only error from the `withConnection()` promise
                    // should be connection errors.
                });
            }).catch(connectionPromiseResolver.reject),
        ]);

        return value;
    }
}
