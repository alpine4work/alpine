import {handleResizeAvatarRequest} from "~/server/files/processor/lambda/request_handlers/handle_resize_avatar_request.js";
import {createHttpLambdaHandler} from "~/server/lambda/create_http_lambda_handler.js";

// Used for tracing. Keeps span naming consistent with existing ECS service.
const route = "/avatar/{entityType}/{entityId}/{version}";

/**
 * Lambda handler for avatar creation from any image type.
 * Accepts web-safe and non-web-safe images, extracts first frame from animated images,
 * and creates optimized square avatars.
 */
export const handler = createHttpLambdaHandler({
    handleRequest: handleResizeAvatarRequest,
    route,
    serviceName: "FileProcessorService",
    tokenServiceName: "FileProcessorService",
});
