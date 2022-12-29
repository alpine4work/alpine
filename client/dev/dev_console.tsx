import {useCallback, useEffect, useState} from "react";
import {
    ColorScheme,
    getColorSchemeWithoutListening,
    setColorScheme,
    toggleColorScheme,
} from "~/client/design/color_scheme";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {generateId} from "~/shared/id/id";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";

const devConsole = {
    generateId,
    toggleColorScheme,
};

defineSchemaProperty<ColorScheme>(
    devConsole,
    "colorScheme",
    Schema.enum(["light", "dark"]),
    () => assertExists(getColorSchemeWithoutListening()),
    setColorScheme,
);

/**
 * Attach the developer console object to window under `dev`.
 */
export function attachDevConsole() {
    // Only give access to developer console tools in development environments (for
    // now). In the future we will allow signed in internal users to access
    // these tools.
    if (process.env.NODE_ENV !== "production") {
        // @ts-expect-error cyberworlds doesn't exist on windows types
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
 * Small utility for attaching debug tools to a global `cyberworlds` (or `c`
 * for short) object in development.
 *
 * These tools are useful for manipulating the application in development from
 * the browser console.
 */
export function useDevConsoleTool(key: string, createTools: () => object) {
    useEffect(() => {
        // If the tools already exist, don't add them again. Only the first component
        // to attach debug tools will be usable.
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
    [K in keyof Config]: Config[K] extends DevConsoleSettingsObjectConfigMethod
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
            const wrappedState: Record<string, unknown> = {
                reset: () => {
                    clearSessionStoragePrefix(groupKey);
                    setState(getDefaultsFromConfig(groupKey, config));
                },
                changes: () => {
                    const changes: Record<string, unknown> = {};
                    for (const [key, item] of Object.entries(config)) {
                        if (typeof item === "function") continue;
                        if (item.defaultValue === state[key]) continue;
                        changes[key] = state[key];
                    }
                    return changes;
                },
            };
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
        const item = sessionStorage.getItem(`cyberworldsDevConsole.${key}`);
        if (!item) return defaultValue;
        return schema.deserialize(JSON.parse(item));
    } catch {
        return defaultValue;
    }
}

function writeSessionStorage<T>(key: string, schema: Schema<T>, newValue: T) {
    sessionStorage.setItem(
        `cyberworldsDevConsole.${key}`,
        JSON.stringify(schema.serialize(newValue)),
    );
}

function clearSessionStoragePrefix(keyToFind: string) {
    const prefix = `cyberworldsDevConsole.${keyToFind}`;
    const keysToClear = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) keysToClear.push(key);
    }
    for (const key of keysToClear) {
        sessionStorage.removeItem(key);
    }
}
