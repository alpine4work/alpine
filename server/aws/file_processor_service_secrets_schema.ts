import {ServerSecretsSchema} from "~/server/aws/server_secrets_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const FileProcessorServiceSecretsSchema = ServerSecretsSchema.merge(
    Schema.object({
        servicePrivateKey: Schema.string.originalPropertyKey("fileProcessorServicePrivateKey"),
    }),
);
