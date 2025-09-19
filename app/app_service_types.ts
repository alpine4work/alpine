import {IncomingMessage, ServerResponse} from "http";
import {ServiceCloudflareR2Options} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {ServerBasicProcessContextOptions} from "~/server/node/create_server_basic_process_context_modules.js";
import {ServiceTokenAgentOptions} from "~/server/node/create_service_token_agent.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export type AppServiceConstants = {
    readonly tracer: TracerRoot;
    readonly shutdownManager: ShutdownManagerBase;
    readonly options: ServiceTokenAgentOptions &
        ServerBasicProcessContextOptions &
        ServiceCloudflareR2Options & {
            readonly shouldSeedDynamo?: boolean;
            readonly edgeServiceUrl?: string;
            readonly opensearchLocalPort?: string;
            readonly opensearchHost?: string;
            readonly taskRealtimeServiceLocalPort?: string;
            readonly ecsCluster?: string;
            readonly taskRealtimeServiceEcsTaskDefinitionFamily?: string;
            readonly taskRealtimeServiceSecurityGroupId?: string;
            readonly allMiniLmL6V2LanguageModel?: string;
            readonly cohereApiKey?: string;
            readonly apnsCertificate?: string;
            readonly apnsCertificatePrivateKey?: string;
            readonly agentServiceLocalPort?: string;
            readonly chatGptLocalUnscopedApiKey?: string;
            readonly chatGptLocalScopedApiKey?: string;
        };
};

export type AppService = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void;

export type AppServiceModule = {
    readonly getAppService: (constants: AppServiceConstants) => Promise<AppService>;
};
