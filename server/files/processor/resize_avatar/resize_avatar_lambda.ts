import {FileProcessorServiceSecretsSchema} from "~/server/aws/file_processor_service_secrets_schema.js";
import {handleResizeAvatarRequest} from "~/server/files/processor/resize_avatar/handle_resize_avatar_request.js";
import {createHttpLambdaHandler} from "~/server/lambda/create_http_lambda_handler.js";

// Used for tracing. Keeps span naming consistent with existing ECS service.
const route = "/avatar";

/**
 * Lambda handler for avatar creation from any image type.
 * Accepts web-safe and non-web-safe images, extracts first frame from animated images,
 * and creates optimized square avatars.
 */
export const handler = createHttpLambdaHandler({
    handleRequest: handleResizeAvatarRequest,
    serviceSecretsSchema: FileProcessorServiceSecretsSchema,
    route,
    serviceName: "FileProcessorService",
    honeycombDataset: "tracer",
});
