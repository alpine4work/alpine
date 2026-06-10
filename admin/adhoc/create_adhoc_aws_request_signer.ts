import {fromIni} from "@aws-sdk/credential-providers";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";

/**
 * Create an `AwsClient` using the machine's local credentials usually configured
 * by the AWS CLI.
 */
export async function createAdhocAwsRequestSigner({profile}: {profile?: string} = {}) {
    if (profile === "local") {
        return new AwsRequestSigner({
            accessKeyId: "local",
            secretAccessKey: "local",
        });
    }

    return new AwsRequestSigner(fromIni({profile}));
}
