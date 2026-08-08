import {AwsCredentialIdentity, Provider} from "@smithy/types";
import {AwsClient} from "aws4fetch";
import {InternalError} from "~/shared/error/error.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Requests sent to AWS [need to be signed][1] by AWS credentials. This is usually
 * handled by the AWS SDK. However, sometimes you want to send requests to AWS
 * directly with an HTTP client. This class allows you to do that. You provide AWS
 * credentials (or a credential provider) and you'll get a function to sign
 * requests.
 *
 * If you don't provide credentials we'll use the default Node.js AWS credentials
 * provider.
 *
 * [1]: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_aws-signing.html
 */
export class AwsRequestSigner {
    private readonly _credentialsProvider: Provider<AwsCredentialIdentity>;

    private _currentState: Promise<{
        credentials: AwsCredentialIdentity;
        client: AwsClient;
    }> | null = null;
    private _nextState: Promise<{
        credentials: AwsCredentialIdentity;
        client: AwsClient;
    }> | null = null;

    constructor(credentials: AwsCredentialIdentity | Provider<AwsCredentialIdentity>) {
        this._credentialsProvider =
            typeof credentials === "function" ? credentials : async () => credentials;
    }

    private _fetchState(span?: TracerSpan): Promise<{
        credentials: AwsCredentialIdentity;
        client: AwsClient;
    }> {
        const fetchState = async (span?: TracerSpan) => {
            try {
                const credentials = await this._credentialsProvider();

                if (credentials.expiration && span) {
                    span.addData({
                        aws: {
                            credentials: {
                                expirationTime: serializeDateString(credentials.expiration),
                            },
                        },
                    });
                }

                return {
                    credentials,
                    client: new AwsClient({
                        accessKeyId: credentials.accessKeyId,
                        secretAccessKey: credentials.secretAccessKey,
                        sessionToken: credentials.sessionToken,
                    }),
                };
            } catch (error) {
                throw InternalError.from(error, "Couldn\u2019t fetch AWS credentials");
            }
        };

        return span ? span.withSpan("Fetching AWS credentials", fetchState) : fetchState();
    }

    private async _getState(span?: TracerSpan): Promise<{
        credentials: AwsCredentialIdentity;
        client: AwsClient;
    }> {
        if (this._currentState === null) {
            this._currentState = this._fetchState(span);

            // If there was an error, we should retry next call.
            this._currentState.catch(() => {
                this._currentState = null;
            });
        }

        const state = await this._currentState;

        const currentTime = Date.now();

        if (state.credentials.expiration) {
            const expirationTime = state.credentials.expiration.getTime();

            // Fetch new AWS credentials 5 seconds before our current credentials expire. That
            // way we have new credentials available immediately after our current credentials
            // expire.
            if (currentTime - 5 * 1000 > expirationTime && this._nextState === null) {
                this._nextState = this._fetchState(span);
            }

            // If our credentials have expired then use the next state promise if it exists,
            // otherwise we need to fetch our state fresh.
            if (currentTime > expirationTime) {
                if (this._nextState !== null) {
                    this._currentState = this._nextState;
                    this._nextState = null;
                    return await this._getState(span);
                } else {
                    this._currentState = this._fetchState(span);
                    return await this._getState(span);
                }
            }
        }

        return state;
    }

    /**
     * Make sure the credentials are available for signing so we don't have to wait for
     * them to be fetched.
     */
    public async prefetchState(span: TracerSpan) {
        await this._getState(span);
    }

    // Property instead of a method so you can pass it around like
    // `fetch(url, {sign: signer.sign})`.
    public readonly sign = async (request: Request, span?: TracerSpan): Promise<Request> => {
        const state = await this._getState(span);
        return await state.client.sign(request);
    };
}
