import {ReactNode, createContext, useContext, useState} from "react";
import {InternalError} from "~/shared/error/error.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

let nextGlobalContextId = 1;

const ActualGlobalContext = createContext<Map<number, any> | null>(
    // Provide a default context implementation in unit tests so you don't need to
    // use `useGlobalContextProvider()`.
    import.meta.jest ? new Map() : null,
);

export type GlobalContext<Value> = {
    readonly id: number;
    readonly create: () => Value;
};

/**
 * Create global React context.
 *
 * Global React context is a helper for context that has a single instance
 * which is shared across the entire app. It allows you to avoid creating new
 * context provider components which add cost to React renders and make
 * debugging more difficult (since you have to scroll past them in the React
 * debugger, React profiler, and performance stack traces).
 *
 * You often need to use global React context instead of creating a global
 * variable since when server rendering you need a separate instance of the
 * global context for each render.
 *
 * Global context is automatically available in unit tests unlike React context
 * which requires you to render a provider.
 */
export function createGlobalContext<Value>(create: () => Value): GlobalContext<Value> {
    return {
        id: nextGlobalContextId++,
        create,
    };
}

export function useGlobalContext<Value>(context: GlobalContext<Value>): Value {
    const actualGlobalContext = useContext(ActualGlobalContext);

    if (actualGlobalContext === null) {
        throw new InternalError(
            `Expected \`useGlobalContextProvider()\` hook to be used at the root of the app`,
        );
    }

    return getOrSetDefaultMapValue(actualGlobalContext, context.id, context.create);
}

export function useGlobalContextProvider(children: ReactNode) {
    const parentActualGlobalContext = useContext(ActualGlobalContext);

    if (parentActualGlobalContext !== null) {
        throw new InternalError(
            `Found parent \`useGlobalContextProvider()\` hook, there should be only one \`useGlobalContextProvider()\` hook at the root of your app`,
        );
    }

    const [actualGlobalContext] = useState(() => new Map());

    return (
        <ActualGlobalContext.Provider value={actualGlobalContext}>
            {children}
        </ActualGlobalContext.Provider>
    );
}
