import {ServerRoute} from "@remix-run/server-runtime";
import {ServerUnknownActionContextModules} from "~/server/context/server_action_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {SessionCookie} from "~/server/tokens/session_cookie.js";
import {AppServiceTokenAgent} from "~/server/tokens/token_agent.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type LoaderContext = Context<LoaderContextModules>;

export type LoaderContextModules = MergeObjectIntersection<
    ServerUnknownActionContextModules & {
        rpc: LocalRpcContextModule;
        loader: LoaderContextModule;

        /**
         * Our Remix server has access to the tasks context module which we don't make
         * generally available to a `ServerActionContext`.
         */
        tasks: TaskContextModule;
    }
>;

export interface LoaderArgs {
    request: Request;
    context: LoaderContext;
    params: {readonly [key: string]: string | undefined};
    // This is added by a patch to `@remix-run/server-runtime`.
    span: TracerSpan;
    // This is added by a patch to `@remix-run/server-runtime`.
    serverRoutes: Array<ServerRoute>;
}

/**
 * Context only available when running a Remix loader.
 */
export class LoaderContextModule extends ContextModuleBase {
    /**
     * Allow Remix loaders to sign tokens and encrypt data with our token agent.
     */
    public readonly tokenAgent: AppServiceTokenAgent;

    /**
     * Manipulate the HTTP session cookie. Important to remember that the client
     * may authenticate with an `Authorization` header instead of a session cookie!
     * In this case the session cookie will be null.
     */
    public readonly sessionCookie: SessionCookie;

    /**
     * Information about the client available on the server. For example client
     * screen size and client locale. On our first request we will guess client
     * info from the user agent. When the client loads it will write its actual
     * information to a cookie.
     */
    public readonly clientInfo: ClientInfo;

    /**
     * Port of the Remix dev server if we are running alongside the Remix
     * dev server.
     */
    public readonly devServerPort: number | null;

    constructor({
        tokenAgent,
        sessionCookie,
        clientInfo,
        devServerPort,
    }: {
        tokenAgent: AppServiceTokenAgent;
        sessionCookie: SessionCookie;
        clientInfo: ClientInfo;
        devServerPort: number | null;
    }) {
        super();
        this.tokenAgent = tokenAgent;
        this.sessionCookie = sessionCookie;
        this.clientInfo = clientInfo;
        this.devServerPort = devServerPort;
    }
}
