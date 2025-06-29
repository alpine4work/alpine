import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Context with only the modules required by DynamoDB.
 */
export type DynamoContext = Context<DynamoContextModules>;

export type DynamoContextModules = {
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    batch?: BatchContextModule;
};
