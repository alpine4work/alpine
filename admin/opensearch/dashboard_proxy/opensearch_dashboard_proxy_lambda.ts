/* eslint-disable no-commit-blockers */
// NOCOMMIT: Remove the above

import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {Hash} from "@smithy/hash-node";
import {NodeHttpHandler} from "@smithy/node-http-handler";
import {HttpRequest} from "@smithy/protocol-http";
import {SignatureV4} from "@smithy/signature-v4";
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda";
import {NotFoundError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const nodeHttpHandler = new NodeHttpHandler();

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // NOCOMMIT: Remove after we make sure this works?
        // eslint-disable-next-line no-console
        console.log("Event:", JSON.stringify(event, null, 2));

        // Only allow requests to `/_plugin/_dashboards`. All other requests to the
        // OpenSearch domain are ignored. As recommended here:
        //
        // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/dashboards.html#dashboards-proxy
        if (
            event.path !== "/_plugin/_dashboards" &&
            !event.path.startsWith("/_plugin/_dashboards/")
        ) {
            throw new NotFoundError("Not found");
        }

        // Get OpenSearch endpoint from environment
        const opensearchUrl = new URL(`https://${assertExists(process.env.OPENSEARCH_HOST)}`);

        // Sign the request to OpenSearch with current IAM credentials
        const request = new HttpRequest({
            hostname: opensearchUrl.hostname,
            port: parseInt(opensearchUrl.port, 10),
            method: event.httpMethod,
            path: event.path,
            query: event.queryStringParameters
                ? Object.fromEntries(
                      Object.entries(event.queryStringParameters).map(([key, value]) => [
                          key,
                          value ?? "",
                      ]),
                  )
                : undefined,
            headers: {...event.headers, host: opensearchUrl.host},
            body: event.body || "",
        });

        const signer = new SignatureV4({
            credentials: defaultProvider(),
            region: process.env.AWS_REGION ?? "us-east-1",
            service: "es",
            sha256: Hash.bind(null, "sha256"),
        });

        const signedRequest = (await signer.sign(request)) as HttpRequest;

        const {response} = await nodeHttpHandler.handle(signedRequest);

        // Return the response from OpenSearch
        return {
            statusCode: response.statusCode,
            headers: {
                ...response.headers,
                // NOCOMMIT: Seems dangerous
                // "Access-Control-Allow-Origin": "*",
                // "Access-Control-Allow-Headers":
                //     "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                // "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
            },
            body: response.body,
        };
    } catch (error) {
        // NOCOMMIT: Remove after we make sure this works?
        // eslint-disable-next-line no-console
        console.error("Error:", error);

        return {
            statusCode: isSystemError(error) ? 500 : 400,
            headers: {
                "Content-Type": "application/json",
                // NOCOMMIT: Seems dangerous
                // "Access-Control-Allow-Origin": "*",
                // "Access-Control-Allow-Headers":
                //     "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                // "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
            },
            body: JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
        };
    }
}
