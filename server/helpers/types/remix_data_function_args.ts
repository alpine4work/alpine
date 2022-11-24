import type {Params} from "react-router-dom";
import type {ServerContext} from "~/server/context/server_context";
import type {Session} from "~/server/session/session";

export interface DataFunctionArgs {
    request: Request;
    context: AppLoadContext;
    params: Params;
}

export type AppLoadContext = {
    context: ServerContext;
    sessionPromise: Promise<Session>;
};
