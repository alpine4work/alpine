import type {UnauthenticatedAppWorkerRequestContext} from "~/server/context/app_worker_context";

export interface DataFunctionArgs {
    request: Request;
    context: UnauthenticatedAppWorkerRequestContext;
    params: {readonly [key: string]: string | undefined};
}
