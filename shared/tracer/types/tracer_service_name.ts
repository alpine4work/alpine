/**
 * The name of the service our tracer is for.
 *
 * The "Test" service is a generic service we use for executing unit tests. Usually
 * the tests are executed with Jest.
 *
 * ## How to decide when to add a new service
 *
 * We do not consider ourselves a microservice shop. Yet we still have a number of
 * different services. We prefer unified frameworks and shared infrastructure
 * wherever possible.
 *
 * You should only create a new service when it makes _physical_ sense not
 * _logical_ sense.
 *
 * What does that mean? A logical justification for a new service is "we're
 * building out a new calendar feature which has its own database, lets put it in a
 * separate service". This is a logical justification since it's based on the new
 * logic being different from what we currently have. A physical justification for
 * a new service is "our video conferencing feature is CPU intensive and starving
 * other code so let's move it to a separate service".
 *
 * A new service makes physical sense when there are physical constraints (CPU,
 * memory, cores, GPU, scale, stateful vs stateless) that are different from our
 * current services.
 *
 * Some examples from our current services:
 *
 * - All stateless request/response logic should go in `AppService`. `AppService`
 *   is optimized for this workload.
 * - Each kind of durable object has unique internal state and is scaled/deployed
 *   separately by Cloudflare so individual durable objects have their own
 *   services.
 * - `TaskRealtimeService` is a stateful service that needs to live in AWS so it's
 *   physically close to DynamoDB and OpenSearch. Spaces are routed to individual
 *   cores within our `TaskRealtimeService` fleet.
 */
export type TracerServiceName =
    // Generic name for admin scripts in the `admin` directory.
    | "Admin"
    // Generic name for Jest unit tests and Playwright integration tests.
    | "Test"

    // Our actual services:
    | "MigrationService"
    | "DeployService"
    | "OpensearchDeployScript"
    | "AppClient"
    | "AppService"
    | "EdgeService"
    | "TaskRealtimeService"
    | "JobQueueService"
    | "FileProcessorService"
    | "ApiService"
    | "AgentService"
    | "CliClient"
    | "ChatGptAgentService"
    | "CursorAgentService"
    | "MockAgentService"
    | "AgentV2Service"
    | "ClaudeAgentService"
    | "ResourceService"
    | "LocalRedirectService"
    | "ImporterService"
    | DurableObjectServiceName;

/**
 * The names of services that run as Cloudflare Durable Objects.
 */
export type DurableObjectServiceName =
    | "DocumentCollaborationService"
    | "PostRealtimeService"
    | "ChannelRealtimeService"
    | "ChatRealtimeService"
    | "MyAccountService"
    | "TaskNotesCollaborationService"
    | "SiteRealtimeService";
