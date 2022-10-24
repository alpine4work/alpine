import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is-identifier";
import {quote} from "~/shared/helpers/string/quote";
import {RealtimeChannel} from "~/shared/realtime/realtime-channel";
import {
    ObjectSchemaConfigBase,
    ObjectSchemaConfigType,
    Schema,
    UnionSchemaConfigBase,
    UnionSchemaConfigType,
} from "~/shared/schema/schema";

/**
 * Defines a realtime channel that our server will publish messages to for the
 * client to consume.
 *
 * - `key`: Represents the channel key. All values must be strings. Usually
 *   values are `Id`s. Clients only receive messages from the channel whose
 *   exact key they requested.
 *
 * - `message`: The message sent to clients on the channel. We force your
 *   message type to be a union so you can add new message types to the channel
 *   in the future.
 */
export function defineRealtimeChannel<
    KeyConfig extends ObjectSchemaConfigBase,
    MessageConfig extends UnionSchemaConfigBase<MessageConfig>,
>({
    name,
    key: keyConfig,
    messages: messageConfig,
}: {
    name: string;
    key: KeyConfig;
    messages: MessageConfig;
}): RealtimeChannel<ObjectSchemaConfigType<KeyConfig>, UnionSchemaConfigType<MessageConfig>> {
    assert(isIdentifier(name), "Realtime channel name should be a valid identifier");
    assert(
        name[0] === name[0]?.toUpperCase(),
        "Realtime channel name should start with an upper case letter",
    );

    assert(
        !definedRealtimeChannelName.has(name),
        quote`A definition for a realtime channel named ${name} already exists`,
    );
    definedRealtimeChannelName.add(name);

    const keySchema = Schema.object(keyConfig);
    const messageSchema = Schema.union(messageConfig);

    return {
        name,
        keySchema,
        messageSchema,
    };
}

const definedRealtimeChannelName = new Set<string>();
