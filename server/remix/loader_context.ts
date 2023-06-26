import {ServerRoute} from "@remix-run/server-runtime";
import {MaybeSessionActionContextModules} from "~/server/dynamo/context/action_context.js";
import {SessionCookie} from "~/server/remix/session_cookie.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type LoaderContext = Context<LoaderContextModules>;

export type LoaderContextModules = MergeObjectIntersection<
    MaybeSessionActionContextModules & {
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
    private readonly _sessionCookiePromise: Promise<SessionCookie>;
    public readonly clientInfo: ClientInfo;
    public readonly devServerPort: number | null;

    constructor({
        sessionCookiePromise,
        clientInfo,
        devServerPort,
    }: {
        sessionCookiePromise: Promise<SessionCookie>;
        clientInfo: ClientInfo;
        devServerPort: number | null;
    }) {
        super();
        this._sessionCookiePromise = sessionCookiePromise;
        this.clientInfo = clientInfo;
        this.devServerPort = devServerPort;
    }

    public getSessionCookie() {
        return this._sessionCookiePromise;
    }
}
