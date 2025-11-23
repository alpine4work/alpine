import {createContext, useContext} from "react";
import {ReactContextModule} from "~/client/web/context/react_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";

/**
 * Context available to our React application code on both the client and on
 * the server.
 */
export type AppContext = Context<{
    tracer: TracerContextModule;
    rpc: RpcContextModuleBase;
    react: ReactContextModule;
}>;

const AppReactContext = createContext<AppContext | null>(null);

/**
 * Get `AppContext` from our React context.
 */
export function useAppContext(): AppContext {
    const context = useContext(AppReactContext);
    assert(context, "Expected the React tree to be rendered inside `<AppContextProvider>`");
    return context;
}

/**
 * Get `AppContext` from our React context. Returns null if `AppContext`
 * doesn't exist. `AppContext` should only not exist in Jest unit tests.
 */
export function useAppContextIfExists(): AppContext | null {
    return useContext(AppReactContext);
}

export const AppContextProvider = AppReactContext.Provider;
