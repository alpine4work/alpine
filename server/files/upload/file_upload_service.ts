import {createFileUploadServer} from "~/server/files/upload/file_upload_server.js";
import {createServerProcessContextModule} from "~/server/node/create_server_process_context_module.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {runService} from "~/server/node/run_service.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";

runService({
    serviceName: "FileUploadService",
    options: {
        port: {type: "string"},
    },
    run: async ({options, tracer, shutdownManager}) => {
        const port = options.port ? parseInt(options.port, 10) : null;
        if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

        const processContext = Context.new({
            process: createServerProcessContextModule(tracer),
            tracer: new TracerContextModule(tracer),
        });

        const server = createFileUploadServer(tracer, processContext);

        registerGracefulServerShutdown(shutdownManager, server);

        server.listen(port, () => {
            // Log when ready in production to help when debugging container startup.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Listening on port ${port} (pid ${process.pid})`);
            }
        });
    },
});
