import {ServerRoute} from "@remix-run/server-runtime";
import {ServerUnknownActionContextModules} from "~/server/context/server_action_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {SessionCookie} from "~/server/tokens/session_cookie.js";
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
        sessionCookie,
        clientInfo,
        devServerPort,
    }: {
        sessionCookie: SessionCookie;
        clientInfo: ClientInfo;
        devServerPort: number | null;
    }) {
        super();
        this.sessionCookie = sessionCookie;
        this.clientInfo = clientInfo;
        this.devServerPort = devServerPort;
    }
}
