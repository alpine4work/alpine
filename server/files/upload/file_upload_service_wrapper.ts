import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import {join as joinPath} from "path";
import {CloudflareR2Client} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {filesR2BucketName} from "~/server/files/upload/upload_file.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentParseOptions,
} from "~/server/node/create_service_token_agent.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    cloudflareR2LocalPath: {type: "string"},
    cloudflareAccountId: {type: "string"},
    cloudflareR2AccessKeyId: {type: "string"},
    cloudflareR2SecretAccessKey: {type: "string"},
    ...serviceTokenAgentParseOptions,
    ...serverProcessContextParseOptions,
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
        r2: new CloudflareR2ContextModule(
            process.env.NODE_ENV !== "production"
                ? (() => {
                      const bucketNames = [filesR2BucketName];

                      const cloudflareR2LocalPath = assertExists(
                          options.cloudflareR2LocalPath,
                          "`cloudflareR2LocalPath` option is required in development",
                      );

                      const bucketByName = new Map(
                          bucketNames.map(bucketName => {
                              const r2Storage = new FileStorage(
                                  joinPath(cloudflareR2LocalPath, bucketName),
                              );
                              const r2Bucket = new R2Bucket(r2Storage);
                              return [bucketName, r2Bucket];
                          }),
                      );

                      return new MiniflareR2Client(bucketByName);
                  })()
                : new CloudflareR2Client({
                      accountId: assertExists(
                          options.cloudflareAccountId,
                          "`cloudflareAccountId` option is required in production",
                      ),
                      accessKeyId: assertExists(
                          options.cloudflareR2AccessKeyId,
                          "`cloudflareR2AccessKeyId` option is required in production",
                      ),
                      secretAccessKey: assertExists(
                          options.cloudflareR2SecretAccessKey,
                          "`cloudflareR2SecretAccessKey` option is required in production",
                      ),
                  }),
        ),
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
