import {AwsClient} from "aws4fetch";
import {InternalError} from "~/shared/error/error";

export function createAwsClientFromEnv(env: {
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
}): AwsClient {
    const awsAccessKeyId =
        env.AWS_ACCESS_KEY_ID ?? (process.env.NODE_ENV !== "production" ? "local" : null);
    if (!awsAccessKeyId)
        throw new InternalError(
            "Environment variable `AWS_ACCESS_KEY_ID` must be set in production",
        );

    const awsSecretAccessKey =
        env.AWS_SECRET_ACCESS_KEY ?? (process.env.NODE_ENV !== "production" ? "local" : null);
    if (!awsSecretAccessKey)
        throw new InternalError(
            "Environment variable `AWS_SECRET_ACCESS_KEY` must be set in production",
        );

    return new AwsClient({
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
    });
}
