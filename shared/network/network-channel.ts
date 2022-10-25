import {ObjectSchema, UnionSchema} from "~/shared/schema/schema";

export type NetworkChannelKeyType<Channel extends NetworkChannel<any, any>> =
    Channel extends NetworkChannel<infer Key, any> ? Key : never;

export type NetworkChannelMessageType<Channel extends NetworkChannel<any, any>> =
    Channel extends NetworkChannel<any, infer Message> ? Message : never;

/**
 * A channel to which messages are published using a [publish-subscribe
 * pattern][1]. Messages are delivered to clients over WebSockets using
 * [Ably][2].
 *
 * Currently, you may only publish messages on the server using the
 * `publishToNetworkChannel()` function and you may only subscribe to
 * messages on the client using the `subscribeToNetworkChannel()`
 * function.
 *
 * The server is allowed to publish any message. We assume it's properly
 * authenticated. The client may only subscribe to messages once it has gotten
 * authorization to access a channel from the server.
 *
 * [1]: https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern
 * [2]: https://ably.com
 */
export interface NetworkChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
> {
    /**
     * The name of the channel.
     *
     * Must be an identifier that starts with an uppercase letter.
     */
    readonly name: string;

    /**
     * The schema for the channel key. All properties in the key should be strings.
     * The key identifies the specific object messages in the channel are about. It
     * controls message filtering (on the message broker side) and authentication.
     * Clients will only get messages from the channel for the specific,
     * requested, key.
     */
    readonly keySchema: ObjectSchema<Key>;

    /**
     * The schema for a message published on the channel. When subscribing to a
     * channel, the client gets every message.
     *
     * Will always be a union so that we can easily add new message types over time
     * to the channel.
     */
    readonly messageSchema: UnionSchema<Message>;
}
