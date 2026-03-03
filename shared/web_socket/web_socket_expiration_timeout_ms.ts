/**
 * If you don't receive a message from your WebSocket pair in this many
 * milliseconds we will close the connection.
 *
 * On the client we will attempt to reconnect but the server will not attempt to
 * reconnect. (How would it find the client?)
 */
export const webSocketExpirationTimeoutMs = 1000 * 60 * 2;
