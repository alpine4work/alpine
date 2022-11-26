import type {AppWorkerUnauthenticatedRequestContext} from "~/server/context/app_worker_context";

export interface DataFunctionArgs {
    request: Request;
    context: AppWorkerUnauthenticatedRequestContext;
    params: {readonly [key: string]: string | undefined};
}
