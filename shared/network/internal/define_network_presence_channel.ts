import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {hasDefinedNetworkChannelName} from "~/shared/network/internal/define_network_channel";
import {NetworkPresenceChannel} from "~/shared/network/network_presence_channel";
import {ObjectSchemaConfigBase, ObjectSchemaConfigType, Schema} from "~/shared/schema/schema";

/**
 * Defines a network presence channel that our clients will publish their
 * presence state to which will be consumed by other clients.
 *
 * - `key`: Represents the channel key. All values must be strings. Usually
 *   values are `Id`s. Clients only receive messages from the channel whose
 *   exact key they requested.
 *
 * - `state`: The state a client reports to the channel. We force your state
 *   type to be an object so you can add new properties to state in the future.
 */
export function defineNetworkPresenceChannel<
    KeyConfig extends ObjectSchemaConfigBase,
    StateConfig extends ObjectSchemaConfigBase,
>({
    name,
    key: keyConfig,
    state: stateConfig,
}: {
    name: string;
    key: KeyConfig;
    state: StateConfig;
}): NetworkPresenceChannel<ObjectSchemaConfigType<KeyConfig>, ObjectSchemaConfigType<StateConfig>> {
    assert(isIdentifier(name), "Network presence channel name should be a valid identifier");
    assert(
        name[0] === name[0]?.toUpperCase(),
        "Network presence channel name should start with an upper case letter",
    );
    assert(name.endsWith("Presence"), 'Network presence channel name should end with "Presence"');

    // Channel names across our presence channels and regular `NetworkChannel`s
    // should be unique.
    assert(
        !definedNetworkPresenceChannelName.has(name),
        quote`A definition for a network presence channel named ${name} already exists`,
    );
    assert(
        !hasDefinedNetworkChannelName(name),
        quote`A definition for a network channel named ${name} already exists`,
    );
    definedNetworkPresenceChannelName.add(name);

    const keySchema = Schema.object(keyConfig);
    const stateSchema = Schema.object(stateConfig);

    return {
        name,
        keySchema,
        stateSchema,
    };
}

const definedNetworkPresenceChannelName = new Set<string>();

/**
 * Get the names of all network presence channels that have been defined.
 */
export function getAllDefinedNetworkPresenceChannelNames(): IterableIterator<string> {
    return definedNetworkPresenceChannelName.values();
}

/**
 * Has a network presence channel been defined with the provided name?
 */
export function hasDefinedNetworkPresenceChannelName(name: string): boolean {
    return definedNetworkPresenceChannelName.has(name);
}
