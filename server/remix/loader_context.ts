import type {UnauthenticatedRequestContextModules} from "~/server/context/request_context";
import {SessionCookie} from "~/server/session/session_cookie";
import type {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

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
    private readonly _devServerPort: number | null;

    constructor({
        sessionCookiePromise,
        devServerPort,
    }: {
        sessionCookiePromise: Promise<SessionCookie>;
        devServerPort: number | null;
    }) {
        super();
        this._sessionCookiePromise = sessionCookiePromise;
        this._devServerPort = devServerPort;
    }

    public async getSessionCookie() {
        return this._sessionCookiePromise;
    }

    public getDevServerPort() {
        return this._devServerPort;
    }
}
