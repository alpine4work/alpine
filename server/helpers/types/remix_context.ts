import type {Context} from "~/server/context/context";
import type {UnauthenticatedRequestContextModules} from "~/server/context/request_context";
import type {SessionCookie} from "~/server/session/session_cookie";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";

export type RemixContext = Context<RemixContextModules>;

export type RemixContextModules = MergeObjectIntersection<
    UnauthenticatedRequestContextModules & {
        sessionCookie: Promise<SessionCookie>;
    }
>;

export interface DataFunctionArgs {
    request: Request;
    context: RemixContext;
    params: {readonly [key: string]: string | undefined};
}
