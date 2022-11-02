import "~/server/helpers/server-only.server";

import {AwsClient} from "aws4fetch";
import {awsAccessKeyId, awsSecretAccessKey} from "~/server/env/env-variables";

export const awsClient = new AwsClient({
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
});
