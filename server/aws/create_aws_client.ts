import {AwsClient} from "aws4fetch";
import {InternalError} from "~/shared/error/error.js";

export function createAwsClient({
    awsAccessKeyId = process.env.NODE_ENV !== "production" ? "local" : undefined,
    awsSecretAccessKey = process.env.NODE_ENV !== "production" ? "local" : undefined,
}: {
    awsAccessKeyId: string | undefined;
    awsSecretAccessKey: string | undefined;
}): AwsClient {
    if (!awsAccessKeyId)
        throw new InternalError("AWS access key ID must be provided in production");

    if (!awsSecretAccessKey)
        throw new InternalError("AWS secret access key must be provided in production");

    return new AwsClient({
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
    });
}
