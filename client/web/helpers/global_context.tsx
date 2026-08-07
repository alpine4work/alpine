import {ReactElement, ReactNode, createContext, useContext, useState} from "react";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";

let nextGlobalContextId = 1;
let actualGlobalContext: Map<number, any> | null = null;

// eslint-disable-next-line react-refresh/only-export-components
const ActualGlobalContext = createContext<Map<number, any> | null>(null);

export type GlobalContext<Value> = {
    readonly id: number;
    readonly create: (get: <OtherValue>(context: GlobalContext<OtherValue>) => OtherValue) => Value;
};

/**
 * Create global React context.
 *
 * Global React context is a helper for context that has a single instance which is
 * shared across the entire app. It allows you to avoid creating new context
 * provider components which add cost to React renders and make debugging more
 * difficult (since you have to scroll past them in the React debugger, React
 * profiler, and performance stack traces).
 *
 * You often need to use global React context instead of creating a global variable
 * since when server rendering you need a separate instance of the global context
 * for each render.
 *
 * Global context is automatically available in unit tests unlike React context
 * which requires you to render a provider.
 */
export function createGlobalContext<Value>(
    create: (get: <OtherValue>(context: GlobalContext<OtherValue>) => OtherValue) => Value,
): GlobalContext<Value> {
    return {
        id: nextGlobalContextId++,
        create,
    };
}

function actuallyGetGlobalContext<Value>(
    actualGlobalContext: Map<number, any>,
    context: GlobalContext<Value>,
): Value {
    return getOrSetDefaultMapValue(actualGlobalContext, context.id, () =>
        context.create(otherContext => actuallyGetGlobalContext(actualGlobalContext, otherContext)),
    );
}

/**
 * Get a global context. This can be used while server-side rendering.
 */
export function useGlobalContext<Value>(context: GlobalContext<Value>): Value {
    const actualGlobalContext = useContext(ActualGlobalContext);

    if (actualGlobalContext === null) {
        if (import.meta.jest) {
            return getGlobalContext(context);
        }

        throw new InternalError(
            `Expected \`useGlobalContextProvider()\` hook to be used at the root of the app`,
        );
    }

    return actuallyGetGlobalContext(actualGlobalContext, context);
}

/**
 * Get a global context on the client. This will throw an error during server-side
 * rendering. You may only call this on the client.
 */
export function getGlobalContext<Value>(context: GlobalContext<Value>): Value {
    assert(typeof window !== "undefined" || import.meta.jest);

    actualGlobalContext ??= new Map();
    return actuallyGetGlobalContext(actualGlobalContext, context);
}

export function useGlobalContextProvider(children: ReactNode): ReactElement {
    const parentActualGlobalContext = useContext(ActualGlobalContext);

    if (parentActualGlobalContext !== null) {
        throw new InternalError(
            `Found parent \`useGlobalContextProvider()\` hook, there should be only one \`useGlobalContextProvider()\` hook at the root of your app`,
        );
    }

    const [actualGlobalContextFromState] = useState(() => {
        if (typeof window !== "undefined" || import.meta.jest) {
            actualGlobalContext ??= new Map();
            return actualGlobalContext;
        } else {
            return new Map();
        }
    });

    return (
        <ActualGlobalContext.Provider value={actualGlobalContextFromState}>
            {children}
        </ActualGlobalContext.Provider>
    );
}
