import {createContext, useContext} from "react";
import {ReactContextModule} from "~/client/context/react_context_module";
import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {assert} from "~/shared/helpers/control/assert";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base";

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

export function useAppContext() {
    const context = useContext(AppReactContext);
    assert(context, "Expected the React tree to be rendered inside `AppContextProvider`");
    return context;
}

export const AppContextProvider = AppReactContext.Provider;
