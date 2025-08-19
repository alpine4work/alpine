import {handleResizeFileRequest} from "~/server/files/processor/resize_file/handle_resize_file_request.js";
import {createHttpLambdaHandler} from "~/server/lambda/create_http_lambda_handler.js";

// Used for tracing. Keeps span naming consistent with existing ECS service.
const route = "/:spaceId/resize/:fileId";

/**
 * Lambda handler for file resizing.
 * Converts HTTP requests to the same resize logic used in ECS.
 */
export const handler = createHttpLambdaHandler({
    handleRequest: handleResizeFileRequest,
    route,
    serviceName: "FileProcessorService",
    tokenServiceName: "FileProcessorService",
});
