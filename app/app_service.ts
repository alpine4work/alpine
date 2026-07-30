import {ECSClient} from "@aws-sdk/client-ecs";
import {S3Client} from "@aws-sdk/client-s3";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {createRequestHandler} from "@remix-run/node";
import {ServerRoute} from "@remix-run/server-runtime";
import type {RouteMatch} from "@remix-run/server-runtime/dist/routeMatching.js";
import Stripe from "stripe";
import * as build from "virtual:remix/server-build";
import {
    AppServiceProcessContext,
    AppServiceProcessContextModules,
    AppServiceSystemActionContext,
    AppServiceSystemActionContextModules,
} from "~/app/app_service_context.js";
import {AppService, AppServiceConstants} from "~/app/app_service_types.js";
import {authenticateActorContextModule} from "~/app/helpers/authenticate_actor_context_module.js";
import {createAppServerRoutes} from "~/app/router/app_server_routes.js";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {getInitialAppRenderPlatform} from "~/client/web/remix/platform_context.js";
import {getDefaultRouteLayoutForPlatform} from "~/client/web/remix/route_layout_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {ApnsConnectionPool} from "~/server/apns/apns_connection_pool.js";
import {ApnsContextModule} from "~/server/apns/apns_context_module.js";
import {BillingContextModule} from "~/server/billing/billing_context_module.js";
import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {BillingNoopDevelopmentContextModule} from "~/server/billing/billing_noop_development_context_module.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createServiceCloudflareR2ContextModule} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {
    ApnsContextModuleBase,
    TestApnsContextModule,
} from "~/server/context/apns_context_module_base.js";
import {DiscoveryContextModule} from "~/server/context/discovery_context_module.js";
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
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {
    TestWebPushContextModule,
    WebPushContextModule,
} from "~/server/context/web_push_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {TraceOnlyEmailContextModule} from "~/server/emails/trace_only_email_context_module.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    SystemActorContextModule,
    UnknownActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {
    ImporterDevelopmentContextModule,
    createDevelopmentEscalateToImporterServiceContext,
} from "~/server/importer/development/importer_development_context_module.js";
import {ImporterContextModule} from "~/server/importer/importer_context_module.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {NoopSlackContextModule} from "~/server/integrations/slack/noop_slack_context_module.js";
import {SlackContextModule} from "~/server/integrations/slack/slack_context_module.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {createLanguageModelsContextModuleForProcess} from "~/server/language_models/create_language_models_context_module_for_process.js";
import {createServerBasicProcessContextModules} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    getServiceTokenAgentKeyFromOption,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedRequestListener} from "~/server/node/create_standardized_server.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {createServiceOpensearchContextModule} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {LoaderContextModule, LoaderContextModules} from "~/server/remix/loader_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {getSpaceAccountsCacheForTest} from "~/server/spaces/get_space_accounts_cache_for_test.js";
import {
    LogoDevContextModule,
    LogoDevContextModuleBase,
    LogoDevNoopContextModule,
} from "~/server/spaces/logo_dev_context_module.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {createServiceTaskRealtimeServiceRouter} from "~/server/tasks/data/create_service_task_realtime_service_router.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {SessionCookie, withSessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {contentCodeBlockLanguages} from "~/shared/content/code/content_code_block_language.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {getRouteStringFromMatches} from "~/shared/remix/get_route_string_from_matches.js";
import {getTracerEventPropagatedDataForPathname} from "~/shared/tracer/get_tracer_event_propagated_data_for_pathname.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

let appService: {
    constants: AppServiceConstants;
    promise: Promise<AppService>;
} | null = null;

/**
 * Get the app server if it exists and creates the app server if it doesn't already
 * exist. You are expected to pass in the same `constants` object every time this
 * function is called.
 *
 * Our app server is designed this way to work well with Vite hot reloading. If a
 * Vite hot reload happens `AppService` will need to be created again. But it only
 * needs to be created once until the next hot reload.
 */
export function getAppService(constants: AppServiceConstants): Promise<AppService> {
    if (appService !== null) {
        assert(appService.constants === constants);
    } else {
        appService = {
            constants,
            promise: createAppService(constants),
        };
    }

    return appService.promise;
}

async function createAppService({
    tracer: originalTracer,
    startupSpan,
    shutdownManager,
    options,
}: Replace<AppServiceConstants, {shutdownManager: ShutdownManagerBase}>): Promise<AppService> {
    // Make sure we use the correct `TracerRoot` class for the current environment. The
    // constant we get from the wrapper code may be for a completely different class
    // hierarchy.
    const tracer = originalTracer.cloneWithNewClass(TracerRoot);

    const cookieNameSuffix = assertExists(
        options.cookieNameSuffix,
        "Missing `cookieNameSuffix` option",
    );

    if (cookieNameSuffix !== "" && !/^-[a-z0-9-]*[a-z0-9]$/.test(cookieNameSuffix)) {
        throw new InternalError("`cookieNameSuffix` must be alphanumeric characters only");
    }

    const awsSigner = new AwsRequestSigner(defaultProvider());
    if (!startupSpan) {
        assert(process.env.NODE_ENV !== "production", "`startupSpan` is required in production");
    } else {
        void awsSigner.prefetchState(startupSpan);
    }

    const basicProcessContext = Context.new(
        createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
    );

    const [
        tokenAgent,
        embeddingModel,
        taskRealtimeServiceRouter,
        apnsCertificate,
        apnsCertificatePrivateKey,
        webPushVapidPublicKey,
        webPushVapidPrivateKey,
        seedDynamoOptions,
    ] = await runAllPromises([
        createServiceTokenAgent({
            serviceName: "AppService",
            privateSide: TokenAgentAppServicePrivateSide,
            options,
        }),
        process.env.NODE_ENV === "production"
            ? new CohereEmbedEnglishV3LanguageModel({
                  apiKey: assertExists(
                      options.cohereApiKey,
                      "`cohereApiKey` option is required in production",
                  ),
              })
            : AllMiniLmL6V2LanguageModel.new(
                  assertExists(
                      options.allMiniLmL6V2LanguageModel,
                      "`allMiniLmL6V2LanguageModel` option is required in development",
                  ),
              ),
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
        getServiceTokenAgentKeyFromOption(
            assertExists(options.apnsCertificate, "Missing `apnsCertificate` option"),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(
                options.apnsCertificatePrivateKey,
                "Missing `apnsCertificatePrivateKey` option",
            ),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPublicKey, "Missing `webPushVapidPublicKey` option"),
        ),
        getServiceTokenAgentKeyFromOption(
            assertExists(options.webPushVapidPrivateKey, "Missing `webPushVapidPrivateKey` option"),
        ),
        process.env.NODE_ENV !== "production" && options.shouldSeedDynamo
            ? (async () => {
                  const agentServiceLocalPort = assertExists(
                      options.agentServiceLocalPort,
                      "Missing `agentServiceLocalPort` option in development",
                  );

                  const chatGptLocalUnscopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.chatGptLocalUnscopedApiKey,
                          "Missing `chatGptLocalUnscopedApiKey` option in development",
                      ),
                  );

                  const chatGptLocalScopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.chatGptLocalScopedApiKey,
                          "Missing `chatGptLocalScopedApiKey` option in development",
                      ),
                  );

                  const cursorLocalUnscopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.cursorLocalUnscopedApiKey,
                          "Missing `cursorLocalUnscopedApiKey` option in development",
                      ),
                  );

                  const mockChatGptLocalUnscopedApiKey = await getServiceTokenAgentKeyFromOption(
                      assertExists(
                          options.mockChatGptLocalUnscopedApiKey,
                          "Missing `mockChatGptLocalUnscopedApiKey` option in development",
                      ),
                  );

                  return {
                      agentServiceLocalPort,
                      chatGptLocalUnscopedApiKey: chatGptLocalUnscopedApiKey.trim(),
                      chatGptLocalScopedApiKey: chatGptLocalScopedApiKey.trim(),
                      cursorLocalUnscopedApiKey: cursorLocalUnscopedApiKey.trim(),
                      mockChatGptLocalUnscopedApiKey: mockChatGptLocalUnscopedApiKey.trim(),
                  };
              })()
            : null,

        // Make sure to load all code block languages are loaded before `AppService` starts
        // serving HTTP requests. That way if we server render a `<ContentView>` with a
        // code block it'll have syntax highlighting.
        runAllPromises(contentCodeBlockLanguages.map(language => language.getParser())),
    ]);

    const edgeServiceUrl = assertExists(
        options.edgeServiceUrl,
        "`edgeServiceUrl` option is required",
    );

    const resourceServiceUrl = assertExists(
        options.resourceServiceUrl,
        "`resourceServiceUrl` option is required",
    );
    assert(
        options.awsBedrockTokenForDevelopment === undefined ||
            process.env.NODE_ENV !== "production",
        "`awsBedrockTokenForDevelopment` must not be set in production",
    );

    const agentServiceUrl = options.agentServiceUrl ?? null;

    if (process.env.NODE_ENV !== "test") {
        assertExists(agentServiceUrl, "`agentServiceUrl` option is required in production");
    }

    let billingContextModule: BillingContextModuleBase;
    if (process.env.NODE_ENV === "production") {
        assertExists(
            options.stripeSigningSecret,
            "`stripeSigningSecret` option is required in production",
        );

        billingContextModule = new BillingContextModule({
            agentServiceUrl: assertExists(
                agentServiceUrl,
                "`agentServiceUrl` option is required in production",
            ),
            stripe: new Stripe(
                assertExists(
                    options.stripeSecretKey,
                    "`stripeSecretKey` option is required in production",
                ),
            ),
            stripeSigningSecret: options.stripeSigningSecret,
        });
    } else {
        billingContextModule = options.stripeSecretKey
            ? new BillingContextModule({
                  agentServiceUrl: assertExists(
                      agentServiceUrl,
                      "`agentServiceUrl` option is when `stripeSecretKey` is provided in development",
                  ),
                  stripe: new Stripe(options.stripeSecretKey),
                  stripeSigningSecret: options.stripeSigningSecret,
              })
            : new BillingNoopDevelopmentContextModule();
    }

    let slackContextModule: SlackContextModuleBase;

    if (process.env.NODE_ENV === "production") {
        slackContextModule = new SlackContextModule({
            clientId: assertExists(
                options.slackClientId,
                "`slackClientId` option is required in production",
            ),
            clientSecret: assertExists(
                options.slackClientSecret,
                "`slackClientSecret` option is required in production",
            ),
            // We do not currently set a `slackAuthRedirectOrigin` option in production, so
            // this will default to the edge service URL.
            authRedirectOrigin: options.slackAuthRedirectOrigin ?? edgeServiceUrl,
        });
    } else {
        if (options.slackClientId && options.slackClientSecret && options.slackAuthRedirectOrigin) {
            slackContextModule = new SlackContextModule({
                clientId: options.slackClientId,
                clientSecret: options.slackClientSecret,
                authRedirectOrigin: options.slackAuthRedirectOrigin,
            });
        } else {
            slackContextModule = new NoopSlackContextModule();
        }
    }

    // In tests, don't send push notifications. Otherwise in development and production
    // set up a connection pool to APNs so we can send notifications.
    let apnsContextModule: ApnsContextModuleBase;
    if (isTestNodeEnvOrAdminScenariosScript) {
        apnsContextModule = new TestApnsContextModule();
    } else {
        const apnsConnectionPool = new ApnsConnectionPool(basicProcessContext, {
            certificate: apnsCertificate,
            certificatePrivateKey: apnsCertificatePrivateKey,
        });

        shutdownManager.registerListener(
            "Destroying APNs connection pool",
            async (signal, span) => {
                await apnsConnectionPool.destroy(span);
            },
        );

        apnsContextModule = new ApnsContextModule(apnsConnectionPool);
    }

    let logoDevContextModule: LogoDevContextModuleBase;
    if (process.env.NODE_ENV === "production") {
        logoDevContextModule = new LogoDevContextModule({
            secretKey: assertExists(
                options.logoDevSecretKey,
                "`logoDevSecretKey` option is required in production",
            ),
            publishableKey: assertExists(
                options.logoDevPublishableKey,
                "`logoDevPublishableKey` option is required in production",
            ),
        });
    } else {
        logoDevContextModule =
            !options.logoDevSecretKey || !options.logoDevPublishableKey
                ? new LogoDevNoopContextModule()
                : new LogoDevContextModule({
                      secretKey: options.logoDevSecretKey,
                      publishableKey: options.logoDevPublishableKey,
                  });
    }

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
        action: (context: AppServiceSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                AppServiceSystemActionContextModules,
                Exclude<keyof AppServiceProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(
                    // `context.actor` is `undefined` for maintenance jobs. Though we shouldn't be
                    // running maintenance jobs in `AppService`. Handle the case anyway.
                    context.actor?.serviceName ?? "AppService",
                    spaceId,
                ),
            },
            action,
        );
    };

    let importerContextModule: ImporterContextModuleBase;

    // Create the importer context module. In development, we use a runner that calls
    // the process functions directly. The runner captures `processContext` by
    // reference (like `dangerouslyEscalateToSystemContext` does) so it will work even
    // though `processContext` isn't assigned yet.
    if (process.env.NODE_ENV === "production") {
        importerContextModule = new ImporterContextModule({
            s3Client: new S3Client({}),
            bucketName: assertExists(
                options.importUploadsBucketName,
                "`importUploadsBucketName` option is required in production",
            ),
            ecsClient: new ECSClient({}),
            ecsConfig: {
                cluster: assertExists(
                    options.ecsCluster,
                    "`ecsCluster` option is required in production",
                ),
                taskDefinition: assertExists(
                    options.importerServiceEcsTaskDefinition,
                    "`importerServiceEcsTaskDefinition` option is required in production",
                ),
                subnets: assertExists(
                    options.importerServiceSubnets,
                    "`importerServiceSubnets` option is required in production",
                )
                    .split(",")
                    .filter(s => s.length > 0),
                securityGroups: assertExists(
                    options.importerServiceSecurityGroups,
                    "`importerServiceSecurityGroups` option is required in production",
                )
                    .split(",")
                    .filter(s => s.length > 0),
                ebsVolumeRoleArn: assertExists(
                    options.importerServiceEbsVolumeRoleArn,
                    "`importerServiceEbsVolumeRoleArn` option is required in production",
                ),
            },
        });
    } else {
        // In development/test, imports are processed directly in the current process using
        // process.waitUntil. The getter captures `processContext` by reference so it works
        // even though processContext isn't assigned yet at this point.
        importerContextModule = new ImporterDevelopmentContextModule({
            localUploadPath: options.importerLocalUploadPathForTest,
            getProcessContext: () => processContext,
            escalateToImporterServiceContext: createDevelopmentEscalateToImporterServiceContext({
                localUploadPath: options.importerLocalUploadPathForTest,
            }),
        });
    }

    const processContext: AppServiceProcessContext = basicProcessContext.clone({
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        r2: createServiceCloudflareR2ContextModule(options),
        files: new FilesContextModule({tokenAgent, resourceServiceUrl}),
        edge: new EdgeServiceContextModule({tokenAgent, edgeServiceUrl}),
        tasks: new TaskContextModule({
            router: taskRealtimeServiceRouter,
            tokenAgent,
            dangerouslyEscalateToSystemContext,
        }),
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule(tokenAgent)
                : new TraceOnlyEmailContextModule(),
        languageModels: createLanguageModelsContextModuleForProcess({
            awsBedrockTokenForDevelopment: options.awsBedrockTokenForDevelopment,
            embeddingModel,
        }),
        apns: apnsContextModule,
        webPush:
            process.env.NODE_ENV === "test"
                ? new TestWebPushContextModule()
                : new WebPushContextModule({
                      vapidPublicKey: webPushVapidPublicKey,
                      vapidPrivateKey: webPushVapidPrivateKey,
                  }),
        billing: billingContextModule,
        importer: importerContextModule,
        logoDev: logoDevContextModule,
        slack: slackContextModule,
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        notificationsInjection: new NotificationsInjectionContextModule(notificationsInjection),
        searchInjection: new SearchInjectionContextModule(searchInjection),
        spacesInjection: new SpacesInjectionContextModule(spacesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
        sitesInjection: new SitesInjectionContextModule(sitesInjection),
    });

    let hasSeededDynamo = false;

    // In development, Vite handles Remix requests.
    //
    // Note that in development Vite creates a completely separate Node.js runtime
    // environment on the server! This will break a number of JavaScript features you
    // may expect to work:
    //
    // 1. Module scoped caches won't be shared across `app_service_worker.ts` and Vite.
    // 2. The context object created in `app_service_worker.ts` and passed to Vite
    //    won't work with `instanceof` checks.
    //
    // In production (and integration tests) we have one Node.js runtime for Remix code
    // and our custom `app_service_worker.ts` server so the above features will work.
    const handleRequest = createRequestHandler(
        {...build, routes: createAppServerRoutes(build.routes)},
        process.env.NODE_ENV,
    );

    const requestListener = createStandardizedRequestListener<
        "HealthCheck" | "ClearSpaceAccountsCacheForTest" | Array<RouteMatch<ServerRoute>> | null
    >(
        tracer,
        url => {
            if (url.pathname === "/api/internal/healthcheck") return [url.pathname, "HealthCheck"];

            // Add route when running integration tests...
            if (process.env.NODE_ENV === "test") {
                if (url.pathname === "/api/internal/test/clearSpaceAccountsCache")
                    return [url.pathname, "ClearSpaceAccountsCacheForTest"];
            }

            const matches = handleRequest.matchServerRoutes(url);

            let route;
            if (matches === null) {
                route = "/*";
            } else {
                route = getRouteStringFromMatches(matches);
            }

            return [route, matches];
        },
        (request, url, matches, span) => {
            if (typeof matches === "string") {
                switch (matches) {
                    case "HealthCheck": {
                        return Promise.resolve(
                            new Response("200 OK", {
                                status: 200,
                                headers: {"content-type": "text/plain"},
                            }),
                        );
                    }
                    case "ClearSpaceAccountsCacheForTest": {
                        const spaceAccountsCache = getSpaceAccountsCacheForTest();
                        spaceAccountsCache.clearForTest();

                        return Promise.resolve(
                            new Response("200 OK", {
                                status: 200,
                                headers: {"content-type": "text/plain"},
                            }),
                        );
                    }
                    default:
                        throw exhaustive(matches);
                }
            }

            return withSessionCookie(
                {tokenAgent, cookieNameSuffix, request},
                async sessionCookie => {
                    const loaderContextModule = new LoaderContextModule(request, {
                        tokenAgent,
                        cookieNameSuffix,
                        sessionCookie,
                        agentServiceUrl,
                        webPushVapidPublicKey,
                    });

                    let route;
                    if (matches === null) {
                        route = "/*";
                    } else {
                        route = getRouteStringFromMatches(matches);
                    }

                    const response = await processContext.with<
                        Omit<
                            LoaderContextModules,
                            Exclude<keyof AppServiceProcessContextModules, "tracer">
                        >,
                        globalThis.Response
                    >(
                        {
                            tracer: new TracerContextModule(span),
                            rpc: new LocalRpcContextModule(),
                            loader: loaderContextModule,
                            cache: CacheContextModule.new(),
                            batch: BatchContextModule.new(),
                            actor: createActorContextModule(request, tokenAgent, sessionCookie),
                            discovery: new DiscoveryContextModule(),
                        },
                        async context => {
                            // Only include `route`, `platform`, and other information about the client state
                            // if this is a Remix data request or document request. The definition of data
                            // requests and document requests can be found here:
                            //
                            // https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-server-runtime/server.ts#L136-L256
                            //
                            // - Data requests are requests with the `_data` search param
                            // - Document requests are requests for a route with a `default` component exported
                            if (
                                url.searchParams.has("_data") ||
                                (matches && matches[matches.length - 1]?.route.module.default)
                            ) {
                                const clientInfo = context.loader.getClientInfo();
                                const platform = getInitialAppRenderPlatform(clientInfo);

                                span.addPropagatedData({
                                    context: {
                                        route,
                                        platform,
                                        spacingScale: getInitialAppRenderSpacingScale(clientInfo),
                                        routeLayout: getDefaultRouteLayoutForPlatform(platform),
                                        renderingEngine: clientInfo.renderingEngine,
                                        browserId: context.loader.getBrowserId(),
                                    },
                                });

                                const pathnamePropagatedData =
                                    getTracerEventPropagatedDataForPathname(url.pathname);
                                if (pathnamePropagatedData)
                                    span.addPropagatedData(pathnamePropagatedData);
                            }

                            // The first time our server process runs in development, seed DynamoDB with some
                            // initial data. The seed function should be idempotent.
                            if (
                                process.env.NODE_ENV !== "production" &&
                                options.shouldSeedDynamo &&
                                !hasSeededDynamo
                            ) {
                                const options = assertExists(seedDynamoOptions);

                                hasSeededDynamo = true;
                                processContext.process.waitUntil(
                                    processContext.tracer.withSpan(
                                        "Seeding DynamoDB",
                                        async context => {
                                            try {
                                                await seedDynamo(context, options);
                                            } catch (error) {
                                                // If there is an error, log it but don't crash the process.
                                                // eslint-disable-next-line no-console
                                                console.error(
                                                    "Failed to seed DynamoDB data:",
                                                    error,
                                                );
                                            }
                                        },
                                    ),
                                );
                            }

                            // For space layout routes then wait until we discover the `SpaceId` and when we do
                            // call `addPropagatedData()` with the `SpaceId` as context on this request span
                            // and immediate child spans (so "Remix loader" and "Remix action" child spans).
                            if (matches && matches[1]?.route.id === "routes/_space") {
                                const localChildSpans = span.trackLocalChildSpans();

                                const handle = (spaceId: SpaceId) => {
                                    context.discovery.removeDiscoverSpaceIdListener(handle);

                                    if (span.isFinished()) return;

                                    const propagatedData = {context: {spaceId}};
                                    span.addPropagatedData(propagatedData);

                                    for (const localChildSpan of localChildSpans) {
                                        if (!localChildSpan.isFinished()) {
                                            localChildSpan.addPropagatedData(propagatedData);
                                        }
                                    }
                                };

                                context.discovery.addDiscoverSpaceIdListener(handle);
                            }

                            return await handleRequest(
                                request,
                                context,
                                // We already parsed route matches. Pass them to Remix...
                                {url, matches},
                            );
                        },
                    );

                    loaderContextModule.addResponseHeaders(response.headers);

                    // Include the route in an HTTP header so our edge service can use the route in its
                    // HTTP span name.
                    response.headers.set("cyberworlds-route", route);

                    return response;
                },
            );
        },
    );

    return requestListener;
}

function createActorContextModule(
    request: Request,
    tokenAgent: TokenAgent,
    sessionCookie: SessionCookie,
) {
    // We authenticate lazily. If a route doesn't need authentication this function
    // never gets called. You can also parallelize other network requests with
    // authentication deeper in a route. Once we authenticate it is cached for the
    // route.
    return new UnknownActorContextModule<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>(async context => {
        const authorizationHeader = request.headers.get("authorization");

        return await authenticateActorContextModule(context, {
            tokenAgent,
            sessionCookie,
            authorizationHeader,
        });
    });
}
