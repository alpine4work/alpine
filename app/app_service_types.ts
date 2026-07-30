import {IncomingMessage, ServerResponse} from "http";
import {ServiceCloudflareR2Options} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {ServerBasicProcessContextOptions} from "~/server/node/create_server_basic_process_context_modules.js";
import {ServiceTokenAgentOptions} from "~/server/node/create_service_token_agent.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AppServiceConstants = {
    readonly tracer: TracerRoot;
    readonly startupSpan: TracerSpan | null;
    readonly shutdownManager: ShutdownManagerBase;
    readonly options: ServiceTokenAgentOptions &
        ServerBasicProcessContextOptions &
        ServiceCloudflareR2Options & {
            readonly shouldSeedDynamo?: boolean;
            readonly edgeServiceUrl?: string;
            readonly agentServiceUrl?: string;
            readonly opensearchLocalPort?: string;
            readonly opensearchHost?: string;
            readonly taskRealtimeServiceLocalPort?: string;
            readonly ecsCluster?: string;
            readonly taskRealtimeServiceEcsTaskDefinitionFamily?: string;
            readonly taskRealtimeServiceSecurityGroupId?: string;
            readonly allMiniLmL6V2LanguageModel?: string;
            readonly cohereApiKey?: string;
            readonly stripeSecretKey?: string;
            readonly stripeSigningSecret?: string;
            readonly apnsCertificate?: string;
            readonly apnsCertificatePrivateKey?: string;
            readonly webPushVapidPublicKey?: string;
            readonly webPushVapidPrivateKey?: string;
            readonly agentServiceLocalPort?: string;
            readonly chatGptLocalUnscopedApiKey?: string;
            readonly chatGptLocalScopedApiKey?: string;
            readonly chatGptWebhookSecret?: string;
            readonly cursorLocalUnscopedApiKey?: string;
            readonly cursorWebhookSecret?: string;
            readonly mockChatGptLocalUnscopedApiKey?: string;
            readonly mockChatGptWebhookSecret?: string;
            readonly slackClientId?: string;
            readonly slackClientSecret?: string;
            readonly slackAuthRedirectOrigin?: string;
            readonly resourceServiceUrl?: string;
            readonly logoDevSecretKey?: string;
            readonly logoDevPublishableKey?: string;
            readonly cookieNameSuffix?: string;
            readonly importUploadsBucketName?: string;
            readonly importerServiceEcsTaskDefinition?: string;
            readonly importerServiceSubnets?: string;
            readonly importerServiceSecurityGroups?: string;
            readonly importerServiceEbsVolumeRoleArn?: string;
            readonly importerLocalUploadPathForTest?: string;
            // Used to test LLM calls against real AWS Bedrock in development. Optional.
            readonly awsBedrockTokenForDevelopment?: string;
        };
};

export type AppService = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void;

export type AppServiceModule = {
    readonly getAppService: (constants: AppServiceConstants) => Promise<AppService>;
};
