import {AwsClient} from "aws4fetch";
import {awsAccessKeyId, awsSecretAccessKey} from "~/server/env/env_variables";

export const awsClient = new AwsClient({
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
});
