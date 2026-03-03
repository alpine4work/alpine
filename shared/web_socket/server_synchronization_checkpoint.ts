import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Lets us know how up-to-date a client's data is with the server's data. The
 * server generates synchronization checkpoints and sends them to the client.
 * Synchronization checkpoints must be generated on the server because we need the
 * server's clock! We can't use untrusted client clocks for server synchronization
 * checkpoints. The client sends the latest synchronization checkpoint it's seen
 * from the server during realtime backfill and the server will send any realtime
 * events the client has missed.
 *
 * `ServerSynchronizationCheckpoint` is simply a timestamp. But we give it a fancy
 * name and a nominal TypeScript type to force developers to be careful when
 * dealing with this value. You shouldn't generate
 * `ServerSynchronizationCheckpoint`s on the client!
 *
 * There are two main ways you get a `ServerSynchronizationCheckpoint`:
 *
 * 1. When you read realtime data (that needs a `ServerSynchronizationCheckpoint`
 *    for backfilling) we'll generate a checkpoint.
 *
 * 2. While connected to a WebSocket server you receive
 *    `ServerSynchronizationCheckpoint`s in `Pong` messages. Since while you have a
 *    solid connection to a WebSocket server you're receiving realtime events that
 *    keep you synchronized with the server.
 */
export type ServerSynchronizationCheckpoint = Date & {
    readonly _ServerSynchronizationCheckpoint: never;
};

export const ServerSynchronizationCheckpointSchema =
    Schema.date as Schema<any> as Schema<ServerSynchronizationCheckpoint>;

/**
 * Generate a synchronization checkpoint (calls `new Date()`). This will throw if
 * you try to call it on the client.
 */
export function generateServerSynchronizationCheckpoint(): ServerSynchronizationCheckpoint {
    // Can only generate synchronization checkpoints on the server. Throw if you try to
    // run this in a browser environment.
    assert(typeof window === "undefined");

    return new Date() as ServerSynchronizationCheckpoint;
}

/**
 * Generate a synchronization checkpoint (calls `new Date()`). This will throw
 * unless we're in a unit test.
 */
export function generateServerSynchronizationCheckpointForTest(): ServerSynchronizationCheckpoint {
    assert(import.meta.jest);
    return new Date() as ServerSynchronizationCheckpoint;
}
