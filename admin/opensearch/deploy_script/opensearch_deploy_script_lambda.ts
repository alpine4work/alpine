import {
    CdkCustomResourceEvent,
    CdkCustomResourceResponse,
    Context as LambdaContext,
} from "aws-lambda";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {withLambdaTimeout} from "~/server/lambda/helpers/with_lambda_timeout.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {deploySearchEntityIndexes} from "~/server/search/data/index/search_entity_index.js";
import {deployTaskIndexes} from "~/server/tasks/data/task_index.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

const opensearchDomainEndpoint = assertExists(process.env.OPENSEARCH_DOMAIN_ENDPOINT);

/**
 * Our OpenSearch deploy script is called by the AWS CDK as a [CloudFormation
 * custom resource][1]. It runs in [AWS Lambda][2].
 *
 * [1]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
 * [2]: https://aws.amazon.com/lambda/
 */
export async function handler(
    event: CdkCustomResourceEvent,
    lambdaContext: LambdaContext,
): Promise<CdkCustomResourceResponse> {
    const abortController = new AbortController();

    return withLambdaTimeout(lambdaContext, abortController, async () => {
        if (event.RequestType === "Delete") {
            return {
                StackId: event.StackId,
                RequestId: event.RequestId,
                LogicalResourceId: event.LogicalResourceId,
            };
        }

        const tracer = TracerRoot.new({
            serviceName: "Admin",
            // AWS Lambda functions run on Node.js
            jsHost: "Node",
            untrusted: false,
            clock: unsynchronizedSystemClock,
            sendEvent: event => {
                // TODO(calebmer): Our deploy script is in a private isolated VPC subnet which
                // means it can't access Honeycomb. We don't currently have NAT gateways to
                // allow egress from isolated VPC subnets.
                //
                // Once we have a [enterprise plan with Honeycomb we can use AWS
                // PrivateLink][1]. Or if we start running [Honeycomb refinery][2] in our
                // VPC we can send events there.
                //
                // [1]: https://docs.honeycomb.io/integrations/aws/aws-privatelink/
                // [2]: https://docs.honeycomb.io/manage-data-volume/refinery/
                //
                // eslint-disable-next-line no-console
                console.log({
                    time: new Date(event.time).toISOString(),
                    data: event.getFlatData(),
                });
            },
        });

        const signer = new AwsRequestSigner();
        const client = new OpensearchClient({
            url: `https://${opensearchDomainEndpoint}`,
            signer,
            ensureLocalCachePath: null,
        });

        await runAllPromises([
            deployTaskIndexes(tracer, client, abortController),
            deploySearchEntityIndexes(tracer, client, abortController),
        ]);

        return {
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
        };
    });
}
