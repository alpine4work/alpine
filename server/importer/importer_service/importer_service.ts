import {S3Client} from "@aws-sdk/client-s3";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {ImporterServiceContextModule} from "~/server/importer/importer_service/importer_service_context_module.js";
import {
    ImporterServiceProcessContext,
    ImporterServiceSystemActionContext,
} from "~/server/importer/importer_service_context.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    importerAction: {type: "string"},
    spaceId: {type: "string"},
    notionImportId: {type: "string"},
    importUploadsBucketName: {type: "string"},
    ...serverBasicProcessContextOptions,
    ...omitObject(serviceCloudflareR2Options, ["fileProcessorServiceUrl"]),
    ...serviceTokenAgentOptions,
} as const;

export async function run({
    tracer,
    startupSpan,
    shutdownManager,
    options: {
        importerAction,
        spaceId: spaceIdString,
        notionImportId: notionImportIdString,
        importUploadsBucketName,
        ...options
    },
}: {
    tracer: TracerRoot;
    startupSpan: TracerSpan;
    shutdownManager: ShutdownManager;
    options: Options;
}) {
    if (!importerAction) {
        throw new InvalidArgumentError("Expected `importerAction` option");
    }
    if (!spaceIdString) {
        throw new InvalidArgumentError("Expected `spaceId` option");
    }
    if (!notionImportIdString) {
        throw new InvalidArgumentError("Expected `notionImportId` option");
    }
    if (!importUploadsBucketName) {
        throw new InvalidArgumentError("Expected `importUploadsBucketName` option");
    }
    if (!options.edgeServiceUrl) {
        throw new InvalidArgumentError("Expected `edgeServiceUrl` option");
    }
    if (!options.resourceServiceUrl) {
        throw new InvalidArgumentError("Expected `resourceServiceUrl` option");
    }

    const spaceId = spaceIdString as SpaceId;
    const notionImportId = notionImportIdString as NotionImportId;

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const s3Client = new S3Client();
    const importerModule = new ImporterServiceContextModule({
        s3Client,
        bucketName: importUploadsBucketName,
    });

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "ImporterService",
        options,
    });

    const processContext: ImporterServiceProcessContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({
            tokenAgent,
            resourceServiceUrl: options.resourceServiceUrl,
        }),
        importerService: importerModule,
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
    });

    await processContext.tracer.withSpan(
        `Run importer action ${importerAction}`,
        async (context, span) => {
            span.addPropagatedData({context: {spaceId}});

            // Create system action context with cache, batch, and actor modules.
            const actionContext: ImporterServiceSystemActionContext = context.clone({
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: CacheContextModule.new(),
                batch: BatchContextModule.new(),
                actor: SystemActorContextModule.dangerouslyNew("ImporterService", spaceId),
            });

            switch (importerAction) {
                case "ValidateNotionImport":
                    await processValidateNotionImportAndExtractMetadataJob(
                        actionContext,
                        notionImportId,
                    );
                    break;

                case "StartNotionImport":
                    await processStartNotionImportJob(actionContext, notionImportId);
                    break;

                default:
                    throw new InvalidArgumentError(
                        quote`Unknown importer action: ${importerAction}`,
                    );
            }
        },
    );
}
