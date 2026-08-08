import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {getErrorCodeForHttpStatusCode} from "~/shared/error/get_error_code_for_http_status_code.open_source.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {UrlPath} from "~/shared/helpers/http/url_path.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Client for interacting with [Logo.dev][1] which we use for figuring out the name
 * of a company based on an email domain that's signed up.
 *
 * [1]: https://www.logo.dev
 */
export abstract class LogoDevContextModuleBase
    extends ContextModuleBase<{
        tracer: TracerContextModule;
    }>
    implements ForkableContextModuleBase
{
    /**
     * Describe a company using the [Logo.dev brand API][1]. Returns null if no company
     * was found.
     *
     * [1]: https://docs.logo.dev/describe/introduction
     */
    public abstract describe(query: string): Promise<{name: string} | null>;

    /**
     * Get a company logo at the provided size using the [Logo.dev logo API][1].
     * Returns null if no logo was found.
     *
     * [1]: https://docs.logo.dev/logo-images/introduction
     */
    public abstract logo(
        query: string,
        options: {size: number; theme: "light" | "dark"},
    ): Promise<ArrayBuffer | null>;

    public abstract fork(): LogoDevContextModuleBase;
}

export class LogoDevContextModule extends LogoDevContextModuleBase {
    private readonly _secretKey: string;
    private readonly _publishableKey: string;

    constructor({secretKey, publishableKey}: {secretKey: string; publishableKey: string}) {
        super();
        this._secretKey = secretKey;
        this._publishableKey = publishableKey;
    }

    public override async describe(query: string): Promise<{name: string} | null> {
        return await retryWithExponentialBackoff(async retry => {
            return await fetchWithTracer(
                this._context.tracer.getTracer(),
                `http://api.logo.dev/describe/${encodeURIComponent(query)}`,
                {
                    serviceName: "LogoDev",
                    route: "/describe/:query",
                    headers: {authorization: `Bearer ${this._secretKey}`},
                },
                async (response, span) => {
                    span.addData({
                        logoDev: {query},
                    });

                    // Company not found, return null.
                    if (response.status === 404) return null;

                    if (!response.ok) {
                        const errorCode = getErrorCodeForHttpStatusCode(response.status);
                        const ErrorConstructor = getErrorConstructorForCode(errorCode);

                        const error = new ErrorConstructor(
                            `Logo.dev describe request failed with status code ${response.status}`,
                            {cause: response},
                        );

                        // Retry 5xx status codes from Logo.dev assuming they are internal errors on
                        // Logo.dev's side instead of an issue on our side.
                        if (response.status >= 500) {
                            throw retry(error);
                        } else {
                            throw error;
                        }
                    }

                    const description: {
                        name?: string;
                        domain?: string;
                        description?: string;
                        colors?: Array<{hex: string}>;
                    } = await response.json();

                    span.addData({
                        logoDev: {
                            name: description.name,
                            domain: description.domain,
                            description: description.description,
                            colors: description.colors?.map(({hex}) => hex).join(","),
                        },
                    });

                    // It would seem that sometimes Logo.dev returns a 202 response with no `name` only
                    // a `msg` property containing `not found, looking up` when a domain isn't found.
                    if (!description.name) return null;

                    return {
                        name: description.name,
                    };
                },
            );
        });
    }

    public override async logo(
        query: string,
        {size, theme}: {size: number; theme: "light" | "dark"},
    ): Promise<ArrayBuffer | null> {
        const urlPath = new UrlPath(`/${encodeURIComponent(query)}`);

        urlPath.searchParams.set("token", this._publishableKey);
        urlPath.searchParams.set("format", "png");
        urlPath.searchParams.set("theme", theme);
        urlPath.searchParams.set("size", String(size));
        urlPath.searchParams.set("fallback", "404");

        return await retryWithExponentialBackoff(async retry => {
            return await fetchWithTracer(
                this._context.tracer.getTracer(),
                `http://img.logo.dev${urlPath.toString()}`,
                {
                    serviceName: "LogoDev",
                    route: "/:query",
                    headers: {authorization: `Bearer ${this._secretKey}`},
                },
                async (response, span) => {
                    span.addData({
                        logoDev: {query},
                    });

                    // Logo not found, return null.
                    if (response.status === 404) return null;

                    if (!response.ok) {
                        const errorCode = getErrorCodeForHttpStatusCode(response.status);
                        const ErrorConstructor = getErrorConstructorForCode(errorCode);

                        const error = new ErrorConstructor(
                            `Logo.dev logo request failed with status code ${response.status}`,
                            {cause: response},
                        );

                        // Retry 5xx status codes from Logo.dev assuming they are internal errors on
                        // Logo.dev's side instead of an issue on our side.
                        if (response.status >= 500) {
                            throw retry(error);
                        } else {
                            throw error;
                        }
                    }

                    const arrayBuffer = await response.arrayBuffer();

                    // Make sure we include the content length of the logo in the span.
                    span.addData({common: {contentLength: arrayBuffer.byteLength}});

                    return arrayBuffer;
                },
            );
        });
    }

    public override fork() {
        return new LogoDevContextModule({
            secretKey: this._secretKey,
            publishableKey: this._publishableKey,
        });
    }
}

export class LogoDevNoopContextModule extends LogoDevContextModuleBase {
    public override async describe(): Promise<null> {
        return null;
    }

    public override async logo(): Promise<null> {
        return null;
    }

    public override fork() {
        return new LogoDevNoopContextModule();
    }
}
