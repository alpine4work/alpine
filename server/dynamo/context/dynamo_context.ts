import {DynamoBatchContextModule, DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";

/**
 * Context with only the modules required by DynamoDB.
 */
export type DynamoContext = Context<DynamoContextModules>;

export type DynamoContextModules = {
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    dynamoBatchContext?: DynamoBatchContextModule;
};
