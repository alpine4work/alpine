import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {InternalError} from "~/shared/error/error.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverProcessContextOptions,
    ...serviceCloudflareR2Options,
} as const;

export async function run({
    options,
    tracer,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
}) {
    const port = options.port ? parseInt(options.port, 10) : null;
    if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

    const awsSigner = new AwsRequestSigner();

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "FileUploadService",
        options,
    });

    const processContext = createServerProcessContext({
        tracer,
        shutdownManager,
        awsSigner,
        options,
    }).clone({
        r2: createServiceCloudflareR2ContextModule(options),
    });

    const server = createFileUploadService(processContext, tokenAgent);

    registerGracefulServerShutdown(shutdownManager, server);

    server.listen(port, () => {
        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Listening on port ${port} (pid ${process.pid})`);
        }
    });
}
