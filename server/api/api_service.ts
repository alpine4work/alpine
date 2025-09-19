import {apiPaths} from "~/server/api/internal/api_paths.js";
import {createApiServiceServer} from "~/server/api/internal/shared/api_service_server.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {
    DynamoActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/context/dynamo_actor_context_module.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    NotificationsInjectionContextModule,
    SearchInjectionContextModule,
    SpacesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
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
import {
    createServiceOpensearchContextModule,
    serviceOpensearchOptions,
} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
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
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverBasicProcessContextOptions,
    ...serviceOpensearchOptions,
    ...serviceCloudflareR2Options,
    ...serviceTaskRealtimeServiceRouterOptions,
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
    const port = parseInt(assertExists(options.port, "`port` option is required"), 10);
    assert(Number.isInteger(port), "`port` option must be an integer");

    const edgeServiceUrl = assertExists(
        options.edgeServiceUrl,
        "`edgeServiceUrl` option is required",
    );

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "ApiService",
        options,
    });

    const awsSigner = new AwsRequestSigner();

    // Sometimes we want to upgrade a session actor to a system actor. This gives
    // the action escalated the system permission level which is dangerous! The
    // system permission level has broad access to a space. We should tightly
    // control what code is allowed to call this function, only allowed context
    // modules get access and those context modules are expected to treat this as a
    // private variable.
    //
    // It's important we use new caches + batchers here. We don't want to load some
    // data at a higher permission level then let the session context see it. So we
    // derive our new context from the process context to help avoid reusing any
    // request-level caches.
    const dangerouslyEscalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: DynamoActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                ServerSystemActionContextModules,
                Exclude<keyof ServerProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: DynamoSystemActorContextModule.dangerouslyNew(
                    // `context.actor` is `undefined` for maintenance jobs. Though we shouldn't be
                    // running maintenance jobs in `ApiService`. Handle the case anyway.
                    context.actor?.serviceName ?? "ApiService",
                    spaceId,
                ),
            },
            action,
        );
    };

    const processContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({tokenAgent, edgeServiceUrl}),
        edge: new EdgeServiceContextModule({tokenAgent, edgeServiceUrl}),
        tasks: new TaskContextModule({
            tokenAgent,
            router: createServiceTaskRealtimeServiceRouter(options),
            dangerouslyEscalateToSystemContext,
        }),
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
    });

    const server = await createApiServiceServer(processContext, apiPaths, {
        shutdownManager,
        edgeServiceUrl,
        tokenAgent,
    });

    server.listen(port, () => {
        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Listening on port ${port} (pid ${process.pid})`);
        }
    });
}
