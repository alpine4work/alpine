import type {UnauthenticatedRequestContextModules} from "~/server/context/request_context";
import {SessionCookieContextModule} from "~/server/session/session_cookie_context_module";
import type {Context} from "~/shared/context/context";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

export type DataFunctionContext = Context<DataFunctionContextModules>;

export type DataFunctionContextModules = MergeObjectIntersection<
    UnauthenticatedRequestContextModules & {
        sessionCookie: SessionCookieContextModule;
    }
>;

export interface DataFunctionArgs {
    request: Request;
    context: DataFunctionContext;
    params: {readonly [key: string]: string | undefined};
}
