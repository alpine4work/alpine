import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export type ServerSecrets = SchemaType<typeof ServerSecretsSchema>;

export const ServerSecretsSchema = Schema.object({
    appServicePublicKey: Schema.string,
    edgeServiceFamilyPublicKey: Schema.string,
    taskRealtimeServicePublicKey: Schema.string,
    jobQueueServicePublicKey: Schema.string,
    fileProcessorServicePublicKey: Schema.string,
    apiServicePublicKey: Schema.string,
    resourceServicePublicKey: Schema.string,
    importerServicePublicKey: Schema.string,
    servicePrivateKey: Schema.string,
    tokenAgentSecret: Schema.string,
    honeycombApiKey: Schema.string,
    cloudflareR2AccessKeyId: Schema.string,
    cloudflareR2SecretAccessKey: Schema.string,
});
