import {useCallback, useEffect, useState} from "react";
import {
    ColorScheme,
    getColorSchemeWithoutListening,
    setColorScheme,
} from "~/client/design/color_scheme";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";

const cyberworlds = {};

defineSchemaProperty<ColorScheme>(
    cyberworlds,
    "colorScheme",
    Schema.enum(["light", "dark"]),
    () => assertExists(getColorSchemeWithoutListening()),
    setColorScheme,
);

/**
 * Attach the developer console object to window under `cyberworlds`
 * (or `c` for short).
 */
export function attachDeveloperConsole() {
    // @ts-expect-error cyberworlds doesn't exist on windows types
    window.cyberworlds = cyberworlds;
    // @ts-expect-error c doesn't exist on windows types
    window.c = cyberworlds;
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
export function useDeveloperConsoleTool(key: string, createTools: () => object) {
    useEffect(() => {
        // If the tools already exist, don't add them again. Only the first component
        // to attach debug tools will be usable.
        if (hasOwnProperty(cyberworlds, key)) return;

        Object.defineProperty(cyberworlds, key, {
            value: createTools(),
            enumerable: true,
            configurable: true,
            writable: false,
        });

        return () => {
            delete cyberworlds[key];
        };
    });
}

/**
 * Expose an object on the developer console. Properties can be read and written
 * and are kept automatically in sync with the react component.
 */
export function useDeveloperConsoleSettingsObject<T extends Record<string, unknown>>(
    groupKey: string,
    config: {[K in keyof T]: {schema: Schema<T[K]>; defaultValue: T[K]}},
) {
    const [state, setState] = useState(() =>
        mapObjectValues(config, ({schema, defaultValue}, key) => {
            return readSessionStorage(`${groupKey}.${key}`, schema, defaultValue);
        }),
    );

    useDeveloperConsoleTool(
        groupKey,
        useCallback(() => {
            const wrappedState = {};
            for (const [key, {schema}] of Object.entries(config)) {
                defineSchemaProperty(
                    wrappedState,
                    key,
                    schema,
                    () => state[key],
                    newValue => {
                        writeSessionStorage(`${groupKey}.${String(key)}`, schema, newValue);
                        setState(prev => ({...prev, [key]: newValue}));
                    },
                );
            }
            return wrappedState;
        }, [state, config]),
    );

    return state;
}

function readSessionStorage<T>(key: string, schema: Schema<T>, defaultValue: T): T {
    try {
        const item = sessionStorage.getItem(`cyberworldsDeveloperConsole.${key}`);
        if (!item) return defaultValue;
        return schema.deserialize(JSON.parse(item));
    } catch {
        return defaultValue;
    }
}

function writeSessionStorage<T>(key: string, schema: Schema<T>, newValue: T) {
    sessionStorage.setItem(
        `cyberworldsDeveloperConsole.${key}`,
        JSON.stringify(schema.serialize(newValue)),
    );
}
