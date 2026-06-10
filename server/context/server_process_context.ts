import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
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
import {TaskContextModuleBase} from "~/server/context/task_context_module_base.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Generic context for code running at the process level outside of the scope of an
 * individual request. Individual requests should use a `ServerActionContext`.
 *
 * Since this is a shared type across all our services anything we provide access
 * to here must be critical for the operation of every service. For example,
 * OpenSearch is only used by the search product and the task product.
 * `FileProcessorService` doesn't need OpenSearch so it's not included here.
 */
export type ServerProcessContext = Context<ServerProcessContextModules>;

export type ServerProcessContextModules = {
    /**
     * Interact with process state.
     *
     * For example, register promises that must be resolved by the time the server
     * shuts down.
     */
    process: ProcessContextModule;

    /**
     * Report information to our telemetry provider (Honeycomb).
     */
    tracer: TracerContextModule;

    /**
     * Read and write data in DynamoDB.
     *
     * DynamoDB is the source of truth for basically all data across our system. We
     * have other storage providers for specific use cases. Like OpenSearch which
     * provide an easier-to-query view of data in DynamoDB or Cloudflare R2 that stores
     * large objects. But basically all features need access to DynamoDB so it's
     * considered a critical dependency.
     */
    dynamo: DynamoContextModule;

    /**
     * Read and write data in OpenSearch.
     *
     * We have a couple indexes in OpenSearch for data we need to query in a flexible
     * way. For example, our search feature is powered by OpenSearch. Task queries are
     * also powered by OpenSearch since we can efficiently filter/sort using task
     * queries.
     */
    opensearch: OpensearchContextModule;

    /**
     * Send jobs to our job queue.
     *
     * The job queue allows us to process work in the background. Since background
     * processing is a core capability needed by most services we consider the job
     * queue a critical dependency.
     */
    jobs: JobsContextModule;

    /**
     * Access files stored in Cloudflare R2.
     *
     * We use Cloudflare R2 instead of AWS S3 for storing user files since Cloudflare
     * R2 has no egress fees. Cloudflare R2 objects live near our other Cloudflare
     * resources which makes it easier to serve files.
     */
    r2: CloudflareR2ContextModule;

    /**
     * Manages the URLs we use for serving files.
     *
     * We authorize an actor has access to a file then sign a URL which gives them
     * access to the file for the next 24 hours or so.
     */
    files: FilesContextModuleBase;

    /**
     * Communicate with our edge service family.
     *
     * Mostly this is used for broadcasting events to durable objects.
     */
    edge: EdgeServiceContextModuleBase;

    /**
     * Interact with `TaskRealtimeService`.
     *
     * `TaskRealtimeService` maintains task data in realtime. If you want to read task
     * data you go through `TaskRealtimeService` since all other data sources are stale
     * (OpenSearch can be stale by five minutes or more) or incomplete (DynamoDB only
     * has attributes essential for authorization).
     *
     * You can think of `TaskRealtimeService` kind of like a database in this respect.
     * A database whose backing store is split between DynamoDB and OpenSearch (much
     * like how an actual database may split its backing store between the file system
     * and S3).
     */
    tasks: TaskContextModuleBase;

    /**
     * Access non-sensitive app-wide immutable constants.
     *
     * This is used for sharing constants that are relevant to multiple services during
     * runtime and may vary by environment. This _should not_ be used to store secrets
     * or other sensitive information!
     */
    constants: ConstantsContextModule;

    // Access injected functions.
    //
    // These are used to call functions that aren't part of the current Bazel package's
    // dependency graph for either performance reasons or to avoid cyclic dependencies.
    chatInjection: ChatInjectionContextModule;
    notificationsInjection: NotificationsInjectionContextModule;
    documentsInjection: DocumentsInjectionContextModule;
    forumInjection: ForumInjectionContextModule;
    searchInjection: SearchInjectionContextModule;
    spacesInjection: SpacesInjectionContextModule;
    tasksInjection: TasksInjectionContextModule;
    sitesInjection: SitesInjectionContextModule;
};
