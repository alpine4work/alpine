import type {UnauthenticatedSessionRequestContextModules} from "~/server/dynamo/context/request_context";
import {SessionCookie} from "~/server/remix/session_cookie";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import type {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {ClientInfo} from "~/shared/remix/client_info";
import {TracerSpan} from "~/shared/tracer/tracer_span";

export type LoaderContext = Context<LoaderContextModules>;

export type LoaderContextModules = MergeObjectIntersection<
    UnauthenticatedSessionRequestContextModules & {
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
