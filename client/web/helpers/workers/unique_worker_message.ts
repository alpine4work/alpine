/**
 * Wire protocol for the unique worker system. See `unique_worker_client.ts` for an
 * overview of the participants.
 *
 * Messages flow over four channels:
 *
 * - Tab → broker (SharedWorker port): `hello`, `register-leader`,
 *   `unregister-leader`, `connect` (carries a transferred MessagePort).
 * - Broker → tab: `connect-request` (to the leader, carries a transferred
 *   MessagePort) and `leader-lost` (broadcast).
 * - Leader tab → dedicated worker: `connect-port` (carries a transferred
 *   MessagePort).
 * - Dedicated worker ↔ tab (over the connection port): `ready` from the worker,
 *   `close-port` from the tab. All other traffic on the connection port is
 *   `WebWorkerRpc` messages.
 */
export type UniqueWorkerMessage =
    | {
          /**
           * First message a tab sends on its broker port. `clientLockName` is a Web Lock the
           * tab holds for its whole lifetime; the broker watches it to detect the tab going
           * away.
           */
          readonly type: "unique-worker:hello";
          readonly clientLockName: string;
      }
    | {
          /** The sending tab spawned the dedicated worker for `key` and it is ready. */
          readonly type: "unique-worker:register-leader";
          readonly key: string;
      }
    | {
          /** The sending tab is giving up leadership of `key` gracefully. */
          readonly type: "unique-worker:unregister-leader";
          readonly key: string;
      }
    | {
          /**
           * A follower tab wants a connection to `key`'s worker. Carries a transferred
           * MessagePort for the broker to relay to the leader.
           */
          readonly type: "unique-worker:connect";
          readonly key: string;
      }
    | {
          /**
           * Broker → leader tab: a follower wants to connect. Carries the follower's
           * transferred MessagePort; the leader forwards it into its dedicated worker.
           */
          readonly type: "unique-worker:connect-request";
          readonly key: string;
      }
    | {
          /**
           * Broker → all tabs: the leader for `key` is gone (died, or gave up leadership, or
           * was replaced). Followers should discard their connection and request a new one.
           */
          readonly type: "unique-worker:leader-lost";
          readonly key: string;
      }
    | {
          /**
           * Leader tab → dedicated worker: a new connection. Carries a transferred
           * MessagePort (either the leader's own or a relayed follower port).
           */
          readonly type: "unique-worker:connect-port";
      }
    | {
          /** Worker → tab, first message on a connection port: ready for RPC. */
          readonly type: "unique-worker:ready";
      }
    | {
          /** Tab → worker: the tab is closing this connection gracefully. */
          readonly type: "unique-worker:close-port";
      };

/**
 * Narrows unknown `postMessage` data to a {@link UniqueWorkerMessage}. Returns
 * `null` for anything that isn't part of the unique worker protocol (e.g.
 * `WebWorkerRpc` traffic sharing the same port).
 */
export function readUniqueWorkerMessage(data: unknown): UniqueWorkerMessage | null {
    const type = (data as {type?: unknown} | null)?.type;
    if (typeof type !== "string" || !type.startsWith("unique-worker:")) return null;
    return data as UniqueWorkerMessage;
}
