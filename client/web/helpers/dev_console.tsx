import {useCallback, useEffect, useState} from "react";
import {
    ColorScheme,
    getColorSchemeWithoutListeningIfBrowser,
    setColorScheme,
    toggleColorScheme,
} from "~/client/web/helpers/color_scheme.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

const devConsole = {
    // Some helper functions that are useful to have easily accessible.
    generateId,
    generateChronologicalId,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
    toggleColorScheme,
};

defineSchemaProperty<ColorScheme>(
    devConsole,
    "colorScheme",
    Schema.enum(["light", "dark"]),
    () => assertExists(getColorSchemeWithoutListeningIfBrowser()),
    setColorScheme,
);

/**
 * Attach the developer console object to window under `dev`.
 *
 * In non-production environments the dev console is always available so this can
 * be called unconditionally. In production environments only accounts with
 * internal access can use the dev console.
 *
 * We don't allow every account to use the dev console since it would simplify the
 * ability for people to write scripts automating our product. An attacker could
 * write malicious scripts but even a well intentioned person shouldn't be using an
 * undocumented, unversioned API.
 */
export function attachDevConsoleNotInProduction() {
    if (process.env.NODE_ENV !== "production" && !("dev" in window)) {
        // @ts-expect-error `dev` doesn't exist on windows types
        window.dev = devConsole;
    }
}

/**
 * Attach the developer console object to window under `dev` if the provided
 * account has internal system access.
 */
export function attachDevConsoleForAccountInProduction() {
    if (process.env.NODE_ENV === "production" && !("dev" in window)) {
        // @ts-expect-error `dev` doesn't exist on windows types
        window.dev = devConsole;
    }
}

function defineSchemaProperty<T>(
    target: object,
    property: string,
    schema: Schema<T>,
    get: () => T,
    set: (newValue: T) => void,
) {
    assert(!hasOwnProperty(target, property), `property ${property} already set`);
    Object.defineProperty(target, property, {
        enumerable: true,
        get: () => schema.serialize(get()),
        set: (newValue: SchemaSerializedValue) => {
            set(schema.deserialize(newValue));
        },
    });
}

/**
 * Small utility for attaching debug tools to a global `cyberworlds` (or `c` for
 * short) object in development.
 *
 * These tools are useful for manipulating the application in development from the
 * browser console.
 */
export function useDevConsoleTool(key: string, createTools: () => unknown) {
    useEffect(() => {
        // If the tools already exist, don't add them again. Only the first component to
        // attach debug tools will be usable.
        if (hasOwnProperty(devConsole, key)) return;

        Object.defineProperty(devConsole, key, {
            value: createTools(),
            enumerable: true,
            configurable: true,
            writable: false,
        });

        return () => {
            delete devConsole[key];
        };
    });
}

type DevConsoleSettingsObjectConfigProperty<T> = {schema: Schema<T>; defaultValue: T};
type DevConsoleSettingsObjectConfigMethod = (...args: Array<any>) => void;
type UnknownDevConsoleSettingsObjectConfig = Record<
    string,
    DevConsoleSettingsObjectConfigProperty<any> | DevConsoleSettingsObjectConfigMethod
>;
type DevConsoleSettingsObject<Config extends UnknownDevConsoleSettingsObjectConfig> = {
    readonly [K in keyof Config]: Config[K] extends DevConsoleSettingsObjectConfigMethod
        ? Config[K]
        : Config[K] extends DevConsoleSettingsObjectConfigProperty<infer T>
          ? T
          : never;
};

function getDefaultsFromConfig<Config extends UnknownDevConsoleSettingsObjectConfig>(
    groupKey: string,
    config: Config,
): DevConsoleSettingsObject<Config> {
    return mapObjectValues(config, (item, key) => {
        if (typeof item === "function") return item;
        return readSessionStorage(`${groupKey}.${key}`, item.schema, item.defaultValue);
    });
}

/**
 * Expose an object on the developer console. Properties can be read and written
 * and are kept automatically in sync with the react component.
 *
 * @deprecated Currently only used in one place. Could we replace with a one-off
 * `useDevConsoleTool()`?
 */
export function useDevConsoleSettingsObject<Config extends UnknownDevConsoleSettingsObjectConfig>(
    groupKey: string,
    config: Config,
): DevConsoleSettingsObject<Config> {
    const [state, setState] = useState<DevConsoleSettingsObject<Config>>(() =>
        getDefaultsFromConfig(groupKey, config),
    );

    useDevConsoleTool(
        groupKey,
        useCallback(() => {
            // These methods are in the prototype so when debugging from the Chrome console,
            // they are initially hidden. Also so `Object.keys()` on the options object won't
            // reveal them.
            const wrappedState: Record<string, unknown> = Object.create({
                reset: () => {
                    clearSessionStoragePrefix(groupKey);
                    setState(getDefaultsFromConfig(groupKey, config));
                },
                getChanges: () => {
                    const changes: Record<string, unknown> = {};
                    for (const [key, item] of Object.entries(config)) {
                        if (typeof item === "function") continue;
                        if (item.defaultValue === state[key]) continue;
                        changes[key] = state[key];
                    }
                    return changes;
                },
            });
            for (const [key, item] of Object.entries(config)) {
                if (typeof item === "function") {
                    wrappedState[key] = item;
                } else {
                    defineSchemaProperty(
                        wrappedState,
                        key,
                        item.schema,
                        () => state[key],
                        newValue => {
                            writeSessionStorage(
                                `${groupKey}.${String(key)}`,
                                item.schema,
                                newValue,
                            );
                            setState(prev => ({...prev, [key]: newValue}));
                        },
                    );
                }
            }
            return wrappedState;
        }, [config, state, groupKey]),
    );

    return state;
}

function readSessionStorage<T>(key: string, schema: Schema<T>, defaultValue: T): T {
    try {
        const item = sessionStorage.getItem(`cyberworlds/devConsole/${key}`);
        if (!item) return defaultValue;
        return schema.deserialize(JSON.parse(item));
    } catch {
        return defaultValue;
    }
}

function writeSessionStorage<T>(key: string, schema: Schema<T>, newValue: T) {
    sessionStorage.setItem(
        `cyberworlds/devConsole/${key}`,
        JSON.stringify(schema.serialize(newValue)),
    );
}

function clearSessionStoragePrefix(keyToFind: string) {
    const prefix = `cyberworlds/devConsole/${keyToFind}`;
    const keysToClear = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) keysToClear.push(key);
    }
    for (const key of keysToClear) {
        sessionStorage.removeItem(key);
    }
}
