import {S3Client} from "@aws-sdk/client-s3";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    NotificationsInjectionContextModule,
    SearchInjectionContextModule,
    SitesInjectionContextModule,
    SpacesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {ImporterServiceContextModule} from "~/server/importer/importer_service/importer_service_context_module.js";
import {
    ImporterServiceContextModules,
    ImporterServiceProcessContext,
    ImporterServiceProcessContextModules,
    ImporterServiceSystemActionContext,
} from "~/server/importer/importer_service_context.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {createLanguageModelsContextModuleForProcess} from "~/server/language_models/create_language_models_context_module_for_process.js";
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
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {createServiceOpensearchContextModule} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {
    createServiceTaskRealtimeServiceRouter,
    serviceTaskRealtimeServiceRouterOptions,
} from "~/server/tasks/data/create_service_task_realtime_service_router.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    importerAction: {type: "string"},
    spaceId: {type: "string"},
    notionImportId: {type: "string"},
    importUploadsBucketName: {type: "string"},
    // Used to test LLM calls against real AWS Bedrock in development. Optional.
    awsBedrockTokenForDevelopment: {type: "string", optional: true},
    ...serverBasicProcessContextOptions,
    ...omitObject(serviceCloudflareR2Options, ["fileProcessorServiceUrl"]),
    ...serviceTokenAgentOptions,
    ...serviceTaskRealtimeServiceRouterOptions,
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

    assert(
        options.awsBedrockTokenForDevelopment === undefined ||
            process.env.NODE_ENV !== "production",
        "`awsBedrockTokenForDevelopment` must not be set in production",
    );

    const basicProcessContext = Context.new(
        createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
    );

    const [tokenAgent, taskRealtimeServiceRouter] = await runAllPromises([
        createServiceTokenAgent({
            serviceName: "ImporterService",
            options,
        }),
        createServiceTaskRealtimeServiceRouter({
            options,
            context: basicProcessContext,
            registerShutdown: (cleanup: () => void) => {
                shutdownManager.registerListener(
                    "Stopping task realtime service route refresh",
                    async () => cleanup(),
                );
            },
        }),
    ]);

    // Sometimes we want to upgrade a session actor to a system actor. This gives the
    // action escalated the system permission level which is dangerous! The system
    // permission level has broad access to a space. We should tightly control what
    // code is allowed to call this function, only allowed context modules get access
    // and those context modules are expected to treat this as a private variable.
    //
    // It's important we use new caches + batchers here. We don't want to load some
    // data at a higher permission level then let the session context see it. So we
    // derive our new context from the process context to help avoid reusing any
    // request-level caches.
    const dangerouslyEscalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ImporterServiceSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                ImporterServiceContextModules,
                Exclude<keyof ImporterServiceProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(
                    // `context.actor` is `undefined` for maintenance jobs. Though we shouldn't be
                    // running maintenance jobs in `ImporterService`. Handle the case anyway.
                    context.actor?.serviceName ?? "ImporterService",
                    spaceId,
                ),
            },
            action,
        );
    };

    const processContext: ImporterServiceProcessContext = basicProcessContext.clone({
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({
            tokenAgent,
            resourceServiceUrl: options.resourceServiceUrl,
        }),
        languageModels: createLanguageModelsContextModuleForProcess({
            awsBedrockTokenForDevelopment: options.awsBedrockTokenForDevelopment,
        }),
        importerService: importerModule,
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
        sitesInjection: new SitesInjectionContextModule(sitesInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        edge: new EdgeServiceContextModule({tokenAgent, edgeServiceUrl: options.edgeServiceUrl}),
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        tasks: new TaskContextModule({
            tokenAgent,
            router: taskRealtimeServiceRouter,
            dangerouslyEscalateToSystemContext,
        }),
    });

    await processContext.tracer.withSpan(
        `Run importer action ${importerAction}`,
        async (context, span) => {
            span.addPropagatedData({context: {spaceId, notionImportId}});

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
