import {createStandardizedServer} from "~/server/node/create_standardized_server.js";
import {runService} from "~/server/node/run_service.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/internal/task_realtime_server.js";
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";

const TaskRealtimeSendActionTransactionSchema = Schema.object({
    spaceId: Schema.id<SpaceId>(),
    committedTime: Schema.date,
    actions: Schema.array(TaskActionSchema),
});

runService({
    serviceName: "TaskRealtimeService",
    options: {
        port: {type: "string"},
    },
    run: async ({port: portString}, tracer) => {
        const port = portString ? parseInt(portString, 10) : null;
        if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

        const [server, {start}] = TaskRealtimeServer.new();

        // NOCOMMIT: Real discovery promise!
        start(Promise.resolve());

        const httpServer = createStandardizedServer(tracer, async (request, url) => {
            const result = await captureResultPromise(async () => {
                switch (url.pathname) {
                    // This endpoint should be called every time an action transaction is commit in
                    // a space that's part of this server's space partition. We add the actions to
                    // our action history and broadcast realtime events to all connected clients.
                    case "/apply-action-transaction": {
                        if (request.method !== "POST") {
                            throw new InvalidArgumentError(
                                quote`Invalid request method ${request.method}`,
                            );
                        }

                        const actionTransaction =
                            TaskRealtimeSendActionTransactionSchema.deserialize(
                                await request.json(),
                            );

                        await server.applyActionTransaction(actionTransaction);
                        return;
                    }
                    default:
                        throw new NotFoundError("Route not found");
                }
            });

            if (result.ok) {
                return new Response(JSON.stringify({ok: true}), {
                    status: 200,
                    headers: {"Content-Type": "application/json"},
                });
            } else {
                return new Response(
                    JSON.stringify({ok: false, error: ErrorSchema.serialize(result.error)}),
                    {
                        status: isSystemError(result.error) ? 500 : 400,
                        headers: {"Content-Type": "application/json"},
                    },
                );
            }
        });

        httpServer.listen(port, () => {
            // Log when ready in production to help when debugging container startup.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Listening on port ${port}`);
            }
        });
    },
});
