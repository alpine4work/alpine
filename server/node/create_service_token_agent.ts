import fs from "fs-extra";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

export const serviceTokenAgentOptions = {
    appServicePublicKey: {type: "string"},
    edgeServiceFamilyPublicKey: {type: "string"},
    taskRealtimeServicePublicKey: {type: "string"},
    jobQueueServicePublicKey: {type: "string"},
    fileProcessorServicePublicKey: {type: "string"},
    apiServicePublicKey: {type: "string"},
    resourceServicePublicKey: {type: "string"},
    importerServicePublicKey: {type: "string"},
    servicePrivateKey: {type: "string"},
    tokenAgentSecret: {type: "string"},
} as const;

export type ServiceTokenAgentOptions = {
    readonly appServicePublicKey?: string;
    readonly edgeServiceFamilyPublicKey?: string;
    readonly taskRealtimeServicePublicKey?: string;
    readonly jobQueueServicePublicKey?: string;
    readonly fileProcessorServicePublicKey?: string;
    readonly apiServicePublicKey?: string;
    readonly resourceServicePublicKey?: string;
    readonly importerServicePublicKey?: string;
    readonly servicePrivateKey?: string;
    readonly tokenAgentSecret?: string;
};

/**
 * Creates a `TokenAgent` from parsed options (from `parseArgs()`) passed to a
 * service. The schema for these options is `serviceTokenAgentOptions`.
 */
export async function createServiceTokenAgent<
    PrivateSide extends TokenAgentPrivateSide = TokenAgentPrivateSide,
>({
    serviceName,
    privateSide: privateSideClass = TokenAgentPrivateSide as any,
    options,
}: {
    serviceName: TokenServiceName;
    privateSide?: {
        "new"(options: {
            serviceName: TokenServiceName;
            servicePrivateKey: string;
            secret: string;
        }): Promise<PrivateSide>;
    };
    options: ServiceTokenAgentOptions;
}): Promise<TokenAgent<PrivateSide>> {
    if (!options.appServicePublicKey)
        throw new InternalError("Missing `appServicePublicKey` option");
    if (!options.edgeServiceFamilyPublicKey)
        throw new InternalError("Missing `edgeServiceFamilyPublicKey` option");
    if (!options.taskRealtimeServicePublicKey)
        throw new InternalError("Missing `taskRealtimeServicePublicKey` option");
    if (!options.jobQueueServicePublicKey)
        throw new InternalError("Missing `jobQueueServicePublicKey` option");
    if (!options.fileProcessorServicePublicKey)
        throw new InternalError("Missing `fileProcessorServicePublicKey` option");
    if (!options.apiServicePublicKey)
        throw new InternalError("Missing `apiServicePublicKey` option");
    if (!options.resourceServicePublicKey)
        throw new InternalError("Missing `resourceServicePublicKey` option");
    if (!options.importerServicePublicKey)
        throw new InternalError("Missing `importerServicePublicKey` option");
    if (!options.servicePrivateKey) throw new InternalError("Missing `servicePrivateKey` option");
    if (!options.tokenAgentSecret) throw new InternalError("Missing `tokenAgentSecret` option");

    const [
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        taskRealtimeServicePublicKey,
        jobQueueServicePublicKey,
        fileProcessorServicePublicKey,
        apiServicePublicKey,
        resourceServicePublicKey,
        importerServicePublicKey,
        servicePrivateKey,
        tokenAgentSecret,
    ] = await runAllPromises([
        getServiceTokenAgentKeyFromOption(options.appServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.edgeServiceFamilyPublicKey),
        getServiceTokenAgentKeyFromOption(options.taskRealtimeServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.jobQueueServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.fileProcessorServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.apiServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.resourceServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.importerServicePublicKey),
        getServiceTokenAgentKeyFromOption(options.servicePrivateKey),
        getServiceTokenAgentKeyFromOption(options.tokenAgentSecret),
    ]);

    const [publicSide, privateSide] = await runAllPromises([
        TokenAgentPublicSide.new({
            serviceName,
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            taskRealtimeServicePublicKey,
            jobQueueServicePublicKey,
            fileProcessorServicePublicKey,
            apiServicePublicKey,
            resourceServicePublicKey,
            importerServicePublicKey,
            secret: tokenAgentSecret,
        }),
        privateSideClass.new({
            serviceName,
            servicePrivateKey,
            secret: tokenAgentSecret,
        }),
    ]);

    return {publicSide, privateSide};
}

/**
 * Our key args may either be a file path or an environment variable name. We first
 * test the environment variable name then try to load as a file path.
 *
 * We allow an environment variable name since an RSA key argument might be too
 * long for the command line. Tools like AWS also make it easiest to pass in
 * secrets through environment variables as opposed to command line arguments or
 * files. As of 2023-08-07 the AWS CDK logic for setting production CLI arguments
 * can be found in `admin/aws/internal/add_all_container_aws_resources.ts`.
 */
export async function getServiceTokenAgentKeyFromOption(arg: string): Promise<string> {
    if (arg.startsWith("/")) {
        return await fs.readFile(arg, "utf8");
    } else {
        return arg;
    }
}
