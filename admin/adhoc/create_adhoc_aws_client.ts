import {fromIni} from "@aws-sdk/credential-providers";
import {AwsClient} from "aws4fetch";

/**
 * Create an `AwsClient` using the machine's local credentials usually
 * configured by the AWS CLI.
 */
export async function createAdhocAwsClient({profile}: {profile?: string} = {}) {
    if (profile === "local") {
        return new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });
    }

    const getCredentials = fromIni({profile});
    const credentials = await getCredentials();

    return new AwsClient({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
    });
}
