import type {UnauthenticatedRequestContextModules} from "~/server/context/request_context";
import {SessionCookieContextModule} from "~/server/session/session_cookie_context_module";
import type {Context} from "~/shared/context/context";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

export type LoadContext = Context<LoadContextModules>;

export type LoadContextModules = MergeObjectIntersection<
    UnauthenticatedRequestContextModules & {
        sessionCookie: SessionCookieContextModule;
    }
>;

export interface DataFunctionArgs {
    request: Request;
    context: LoadContext;
    params: {readonly [key: string]: string | undefined};
}
