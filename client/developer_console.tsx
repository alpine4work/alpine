import {useEffect, useState} from "react";
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

defineSchemaProperty<ColorScheme>(
    cyberworlds,
    "colorScheme",
    Schema.enum(["light", "dark"]),
    () => assertExists(getColorSchemeWithoutListening()),
    setColorScheme,
);

export function useDeveloperConsoleSettingsObject<T extends Record<string, unknown>>(
    groupKey: string,
    config: {[K in keyof T]: {schema: Schema<T[K]>; defaultValue: T[K]}},
) {
    const [state, setState] = useState(() =>
        mapObjectValues(config, ({schema, defaultValue}, key) => {
            return readLocalStorage(`${groupKey}.${key}`, schema, defaultValue);
        }),
    );

    useEffect(() => {
        const wrappedObject = new Proxy(state, {
            set(target, property, newValue) {
                assert(hasOwnProperty(config, property));
                const key = property as keyof T;
                const deserialized = config[key].schema.deserialize(newValue);
                writeLocalStorage(`${groupKey}.${String(key)}`, config[key].schema, deserialized);
                setState(prev => ({...prev, [key]: deserialized}));
                return true;
            },
        });

        assert(!hasOwnProperty(cyberworlds, groupKey));
        Object.defineProperty(cyberworlds, groupKey, {
            value: wrappedObject,
            enumerable: true,
            configurable: true,
            writable: false,
        });

        return () => {
            delete cyberworlds[groupKey];
        };
    }, [groupKey, config, state]);

    return state;
}

function readLocalStorage<T>(key: string, schema: Schema<T>, defaultValue: T): T {
    try {
        const item = localStorage.getItem(`cyberworldsDeveloperConsole.${key}`);
        if (!item) return defaultValue;
        return schema.deserialize(JSON.parse(item));
    } catch {
        return defaultValue;
    }
}

function writeLocalStorage<T>(key: string, schema: Schema<T>, newValue: T) {
    localStorage.setItem(
        `cyberworldsDeveloperConsole.${key}`,
        JSON.stringify(schema.serialize(newValue)),
    );
}
