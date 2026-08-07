import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {getErrorCodeForHttpStatusCode} from "~/shared/error/get_error_code_for_http_status_code.open_source.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Client for interacting with [Loops][1] which we use for marketing email
 * sequences.
 *
 * [1]: https://loops.so
 */
export abstract class LoopsContextModuleBase
    extends ContextModuleBase<{
        tracer: TracerContextModule;
    }>
    implements ForkableContextModuleBase
{
    /**
     * Create a Loops contact. This will automatically start our sign up email
     * sequence.
     */
    public abstract createContact(options: {
        emailAddress: EmailAddress;
        accountId: AccountId;
        firstName: string;
        lastName?: string;
        fullName?: string;
    }): Promise<void>;

    public abstract fork(): LoopsContextModuleBase;
}

export class LoopsContextModule extends LoopsContextModuleBase {
    private readonly _apiKey: string;

    constructor({apiKey}: {apiKey: string}) {
        super();
        this._apiKey = apiKey;
    }

    public override async createContact({
        emailAddress,
        accountId,
        firstName,
        lastName,
        fullName,
    }: {
        emailAddress: EmailAddress;
        accountId: AccountId;
        firstName: string;
        lastName?: string;
        fullName?: string;
    }): Promise<void> {
        return await retryWithExponentialBackoff(async retry => {
            return await fetchWithTracer(
                this._context.tracer.getTracer(),
                `https://app.loops.so/api/v1/contacts/create`,
                {
                    serviceName: "Loops",
                    route: "/api/v1/contacts/create",
                    headers: {
                        Authorization: `Bearer ${this._apiKey}`,
                        "Content-Type": "application/json",
                    },
                    method: "POST",
                    body: JSON.stringify({
                        email: emailAddress,
                        userId: accountId,
                        firstName,
                        lastName,
                        fullName,
                    }),
                },
                async (response, span) => {
                    if (!response.ok) {
                        const errorCode = getErrorCodeForHttpStatusCode(response.status);
                        const ErrorConstructor = getErrorConstructorForCode(errorCode);

                        const error = new ErrorConstructor(
                            `Loops create contact request failed with status code ${response.status}`,
                            {cause: response},
                        );

                        // Retry 5xx status codes from Loops assuming they are internal errors on Loops's
                        // side instead of an issue on our side.
                        if (response.status >= 500) {
                            throw retry(error);
                        }
                        // By default the Loops API is rate limited to 10 requests per second. So wait a
                        // second for the rate limit to reset then retry.
                        else if (response.status === 429) {
                            await wait(1000);
                            throw retry(error);
                        } else {
                            throw error;
                        }
                    }

                    const responseBody: {
                        id: string;
                    } = await response.json();

                    span.addData({loops: {contactId: responseBody.id}});
                },
            );
        });
    }

    public override fork() {
        return new LoopsContextModule({
            apiKey: this._apiKey,
        });
    }
}

export class LoopsNoopContextModule extends LoopsContextModuleBase {
    public override async createContact(): Promise<void> {}

    public override fork() {
        return new LoopsNoopContextModule();
    }
}
