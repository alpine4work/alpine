import {NetworkChannelBase} from "~/shared/network/network-channel";
import {ObjectSchema} from "~/shared/schema/schema";

export type NetworkPresenceChannelKeyType<Definition extends NetworkPresenceChannel<any, any>> =
    Definition extends NetworkPresenceChannel<infer Key, any> ? Key : never;

export type NetworkPresenceChannelStateType<Definition extends NetworkPresenceChannel<any, any>> =
    Definition extends NetworkPresenceChannel<any, infer State> ? State : never;

/**
 * A channel in which clients communicate whether or not they are present and
 * some piece of state, usually describing their current location. Under the
 * hood uses a similar [publish-subscribe][1] implementation to
 * `NetworkChannel`. Hence why "channel" is in the name. Presences state is
 * exchanged among clients with [Ably presence][2].
 *
 * Important: Unlike other network abstractions, state is not validated by the
 * server! Clients may publish whatever state they like and other clients will
 * see it as long as it matches the state schema. This means bad actors may
 * hack their clients to send weird states. Be careful when using state to
 * validate correctness.
 *
 * [1]: https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern
 * [2]: https://ably.com/docs/core-features/presence
 */
export interface NetworkPresenceChannel<Key extends {[key: string]: string}, State>
    extends NetworkChannelBase<Key> {
    /**
     * The schema for state that clients report to this presence channel. When
     * subscribed to a presence channel a client gets other present users.
     *
     * Will always be an object so you can easily add new state properties
     * over time.
     */
    readonly stateSchema: ObjectSchema<State>;
}
