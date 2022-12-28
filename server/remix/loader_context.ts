import type {UnauthenticatedRequestContextModules} from "~/server/context/request_context";
import {SessionCookie} from "~/server/session/session_cookie";
import type {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {TracerSpan} from "~/shared/tracer/tracer_span";

export type LoaderContext = Context<LoaderContextModules>;

export type LoaderContextModules = MergeObjectIntersection<
    UnauthenticatedRequestContextModules & {
        loader: LoaderContextModule;
    }
>;

export interface LoaderArgs {
    request: Request;
    context: LoaderContext;
    params: {readonly [key: string]: string | undefined};
}

/**
 * Context only available when running a Remix loader.
 */
export class LoaderContextModule extends ContextModuleBase {
    private readonly _sessionCookiePromise: Promise<SessionCookie>;
    public readonly requestSpan: TracerSpan;
    public readonly devServerPort: number | null;

    constructor({
        sessionCookiePromise,
        requestSpan,
        devServerPort,
    }: {
        sessionCookiePromise: Promise<SessionCookie>;
        requestSpan: TracerSpan;
        devServerPort: number | null;
    }) {
        super();
        this._sessionCookiePromise = sessionCookiePromise;
        this.requestSpan = requestSpan;
        this.devServerPort = devServerPort;
    }

    public getSessionCookie() {
        return this._sessionCookiePromise;
    }
}
