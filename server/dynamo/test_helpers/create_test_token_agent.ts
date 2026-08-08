import fs from "fs/promises";
import {join as joinPath} from "path";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ensureServiceKeys} from "~/admin/helpers/ensure_service_keys.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {
    runAllObjectPromises,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export async function createTestTokenAgent(
    context: TestActualContext,
    serviceName: TokenServiceName,
): Promise<TokenAgent> {
    return (await createTestTokenAgents(context, [serviceName]))[0];
}

export async function createTestTokenAgents<
    const ServiceNames extends ReadonlyArray<TokenServiceName>,
>(
    context: TestActualContext,
    serviceNames: ServiceNames,
): Promise<{[Key in keyof ServiceNames]: TokenAgent}> {
    const keysDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "keys");

    await ensureServiceKeys(keysDirectoryPath);

    const servicePrivateKeyPaths = serviceNames.map(serviceName => {
        switch (serviceName) {
            case "AppService":
                return joinPath(keysDirectoryPath, "app_service_rsa");
            case "TaskRealtimeService":
                return joinPath(keysDirectoryPath, "task_realtime_service_rsa");
            case "JobQueueService":
                return joinPath(keysDirectoryPath, "job_queue_service_rsa");
            case "FileProcessorService":
                return joinPath(keysDirectoryPath, "file_processor_service_rsa");
            case "ApiService":
                return joinPath(keysDirectoryPath, "api_service_rsa");
            case "ResourceService":
                return joinPath(keysDirectoryPath, "resource_service_rsa");
            case "ImporterService":
                return joinPath(keysDirectoryPath, "importer_service_rsa");
            case "EdgeService":
            case "DocumentCollaborationService":
            case "PostRealtimeService":
            case "ChannelRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
            case "TaskNotesCollaborationService":
            case "SiteRealtimeService":
            case "DatabaseGroupService":
                return joinPath(keysDirectoryPath, "edge_service_family_rsa");
            default:
                throw exhaustive(serviceName);
        }
    });

    const [secret, publicKeys] = await runAllPromises([
        fs.readFile(joinPath(keysDirectoryPath, "token_agent_secret"), "utf8"),
        runAllObjectPromises({
            appServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "app_service_rsa.pub"),
                "utf8",
            ),
            edgeServiceFamilyPublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "edge_service_family_rsa.pub"),
                "utf8",
            ),
            taskRealtimeServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "task_realtime_service_rsa.pub"),
                "utf8",
            ),
            jobQueueServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "job_queue_service_rsa.pub"),
                "utf8",
            ),
            fileProcessorServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "file_processor_service_rsa.pub"),
                "utf8",
            ),
            resourceServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "resource_service_rsa.pub"),
                "utf8",
            ),
            apiServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "api_service_rsa.pub"),
                "utf8",
            ),
            importerServicePublicKey: fs.readFile(
                joinPath(keysDirectoryPath, "importer_service_rsa.pub"),
                "utf8",
            ),
        }),
    ]);

    return runAllPromises(
        serviceNames.map((serviceName, i): Promise<TokenAgent> => {
            const servicePrivateKeyPath = servicePrivateKeyPaths[i]!;

            return runAllObjectPromises({
                publicSide: TokenAgentPublicSide.new({
                    serviceName,
                    ...publicKeys,
                    secret,
                }),
                privateSide: runAllObjectPromises({
                    serviceName,
                    servicePrivateKey: fs.readFile(servicePrivateKeyPath, "utf8"),
                    secret,
                }).then(options => TokenAgentPrivateSide.new(options)),
            });
        }),
    ) as {[Key in keyof ServiceNames]: TokenAgent};
}
