import {fromContainerMetadata} from "@aws-sdk/credential-providers";
import {AwsCredentialIdentity} from "@smithy/types";
import {AwsClient} from "aws4fetch";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const serverProcessContextParseOptions = {
    awsAccessKeyId: {type: "string"},
    awsSecretAccessKey: {type: "string"},
    dynamoLocalPort: {type: "string"},
    opensearchLocalPort: {type: "string"},
} as const;

/**
 * Create a `ServerProcessContext`. You should run this at the root of your
 * service. Probably in a `runService()` call.
 *
 * Requires some parameters we expect to come from the command line.
 * `serverProcessContextParseOptions` is an object defining the args you can
 * pass into `parseArgs()`.
 */
export function createServerProcessContext({
    tracer,
    options,
}: {
    tracer: TracerRoot;
    options: {
        awsAccessKeyId?: string;
        awsSecretAccessKey?: string;
        dynamoLocalPort?: string;
        opensearchLocalPort?: string;
    };
}): ServerProcessContext {
    let isLocalAws = false;
    let getAwsCredentials: (
        tracer: TracerBase,
    ) => Promise<AwsCredentialIdentity & {httpClient?: AwsClient}>;
    if (process.env.NODE_ENV !== "production") {
        isLocalAws = !options.awsAccessKeyId;
        getAwsCredentials = async () => ({
            accessKeyId: options.awsAccessKeyId ?? "local",
            secretAccessKey: options.awsSecretAccessKey ?? "local",
        });
    }
    // In production, we load our AWS credentials from container metadata with an
    // API request. These are short-lived credentials so we need to continuously
    // refetch the credentials.
    //
    // Normally this is handled by the AWS SDK but because we use `aws4fetch` we
    // need direct access to the AWS credentials outside of the SDK so we have to
    // implement refresh manually.
    //
    // See: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html
    else {
        if (options.awsAccessKeyId || options.awsSecretAccessKey) {
            throw new InternalError(
                "Not allowed to provide `awsAccessKeyId` and `awsSecretAccessKey` arg in production",
            );
        }

        const actuallyFetchAwsCredentials = fromContainerMetadata();

        const fetchAwsCredentials = (initiatingSpan: TracerSpan | null) =>
            tracer.withSpan("Fetching AWS credentials", async span => {
                // Link this span to the span which initiated it.
                if (initiatingSpan) span.link(initiatingSpan);

                try {
                    const credentials = await actuallyFetchAwsCredentials();

                    if (credentials.expiration) {
                        span.addData({
                            aws: {
                                credentials: {
                                    expirationTime: serializeDateString(credentials.expiration),
                                },
                            },
                        });
                    }

                    return credentials;
                } catch (error) {
                    // Escalate to internal error! If this isn't resolved requests will
                    // start failing.
                    throw InternalError.from(error);
                }
            });

        let currentAwsCredentialsPromise: Promise<AwsCredentialIdentity> =
            fetchAwsCredentials(null);
        let nextAwsCredentialsPromise: Promise<AwsCredentialIdentity> | null;

        getAwsCredentials = async (tracer: TracerBase) => {
            const awsCredentials = await currentAwsCredentialsPromise;

            if (awsCredentials.expiration) {
                const expirationMs = awsCredentials.expiration.getTime() - Date.now();

                // Wait until four minutes before our current AWS credentials expire to fetch
                // new credentials. The docs say new credentials are available five minutes
                // before the expiration time. We fetch four minutes before the expiration time
                // to account for clock drift.
                if (expirationMs < 1000 * 60 * 4) {
                    if (!nextAwsCredentialsPromise) {
                        const ourAwsCredentialsPromise = fetchAwsCredentials(
                            tracer instanceof TracerSpan ? tracer : null,
                        );
                        nextAwsCredentialsPromise = ourAwsCredentialsPromise;

                        ourAwsCredentialsPromise.then(
                            () => {
                                if (nextAwsCredentialsPromise === ourAwsCredentialsPromise) {
                                    currentAwsCredentialsPromise = ourAwsCredentialsPromise;
                                    nextAwsCredentialsPromise = null;
                                }
                            },
                            () => {
                                if (nextAwsCredentialsPromise === ourAwsCredentialsPromise) {
                                    // If there was an error, clear our promise which will cause us to try fetching
                                    // credentials again. Errors should already be reported by `tracer.withSpan()`.
                                    nextAwsCredentialsPromise = null;
                                }
                            },
                        );
                    }

                    // One minute before our expiration time (to account for clock drift) switch to
                    // the new credentials even if we haven't finished fetching them yet.
                    if (expirationMs < 1000 * 60) {
                        currentAwsCredentialsPromise = nextAwsCredentialsPromise;
                        nextAwsCredentialsPromise = null;
                        return currentAwsCredentialsPromise;
                    }
                }
            }

            return awsCredentials;
        };
    }

    const getAwsHttpClient = async (tracer: TracerBase) => {
        const awsCredentials = await getAwsCredentials(tracer);

        return (awsCredentials.httpClient ??= new AwsClient({
            accessKeyId: awsCredentials.accessKeyId,
            secretAccessKey: awsCredentials.secretAccessKey,
            sessionToken: awsCredentials.sessionToken,
        }));
    };

    return Context.new<ServerProcessContextModules>({
        process: new ProcessContextModule({
            // NOCOMMIT: `waitUntil()` should stop the server from shutting down until
            // everything has finished.
            waitUntil: promise => {
                promise.catch(error => {
                    tracer.logUncaughtException("Uncaught exception from `waitUntil()`", error);
                });
            },
        }),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            getAwsHttpClient,
            awsDynamoUrl: !isLocalAws
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : `http://localhost:${parseInt(
                      assertExists(
                          options.dynamoLocalPort,
                          "DynamoDB local port must be provided when running DynamoDB locally",
                      ),
                      10,
                  )}`,
        }),
        email: !isLocalAws
            ? new SesEmailContextModule(getAwsHttpClient)
            : new NoopEmailContextModule(),
        opensearch: OpensearchContextModule.new(
            // NOCOMMIT: Production OpenSearch
            new OpensearchClient({
                protocol: "http",
                host: `http://localhost:${parseInt(
                    assertExists(
                        options.opensearchLocalPort,
                        "OpenSearch local port must be provided when running OpenSearch locally",
                    ),
                    10,
                )}`,
            }),
        ),
    });
}
