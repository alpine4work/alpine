import {ServerRoute} from "@remix-run/server-runtime";
import {parse as parseCookieHeader, serialize as serializeSetCookieHeader} from "cookie";
import {differenceInDays, isValid as isValidDate, parseISO} from "date-fns";
import {Params} from "react-router";
import {ServerUnknownActionContextModules} from "~/server/context/server_action_context.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {SessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {AppServiceTokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {generateId, isId} from "~/shared/id/id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {
    ClientInfo,
    ClientInfoSchema,
    defaultClientInfo,
    defaultMobileClientInfo,
    isAppleDeviceUserAgent,
} from "~/shared/remix/client_info.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type LoaderContext = Context<LoaderContextModules>;

export type LoaderContextModules = MergeObjectIntersection<
    ServerUnknownActionContextModules & {
        rpc: LocalRpcContextModule;
        loader: LoaderContextModule;

        /**
         * Our Remix server has access to the tasks context module which we don't make
         * generally available to a `ServerActionContext`.
         */
        tasks: TaskContextModule;

        /**
         * The language model we use for tasks like embedding search queries.
         */
        languageModel: LanguageModelContextModule;
    }
>;

export interface LoaderArgs {
    request: Request;
    context: LoaderContext;
    params: Params<string>;
    // This is added by a patch to `@remix-run/server-runtime`.
    span: TracerSpan;
    // This is added by a patch to `@remix-run/server-runtime`.
    serverRoutes: Array<ServerRoute>;
}

/**
 * Context only available when running a Remix loader.
 */
export class LoaderContextModule extends ContextModuleBase {
    private readonly _request: Request;

    /**
     * Allow Remix loaders to sign tokens and encrypt data with our token agent.
     */
    public readonly tokenAgent: TokenAgent<AppServiceTokenAgentPrivateSide>;

    /**
     * Manipulate the HTTP session cookie. Important to remember that the client
     * may authenticate with an `Authorization` header instead of a session cookie!
     * In this case the session cookie will be null.
     */
    public readonly sessionCookie: SessionCookie;

    /**
     * Port of the Remix dev server if we are running alongside the Remix
     * dev server.
     */
    public readonly devServerPort: number | null;

    // Context modules can't directly mutate `this` so we need an
    // intermediate object.
    private readonly _state: {
        parsedCookieHeader: {[key: string]: string} | null;
        browserId: BrowserId | null;
        clientInfo: ClientInfo | null;
        addResponseHeaders: Array<(headers: Headers) => void> | null;
        initialTime: Date | null;
    } = {
        parsedCookieHeader: null,
        browserId: null,
        clientInfo: null,
        addResponseHeaders: [],
        initialTime: null,
    };

    constructor(
        request: Request,
        {
            tokenAgent,
            sessionCookie,
            devServerPort,
        }: {
            tokenAgent: TokenAgent<AppServiceTokenAgentPrivateSide>;
            sessionCookie: SessionCookie;
            devServerPort: number | null;
        },
    ) {
        super();
        this._request = request;
        this.tokenAgent = tokenAgent;
        this.sessionCookie = sessionCookie;
        this.devServerPort = devServerPort;
    }

    private _parseCookieHeader() {
        if (this._state.parsedCookieHeader) return this._state.parsedCookieHeader;

        const cookieHeader = this._request.headers.get("cookie");
        if (!cookieHeader) return null;

        this._state.parsedCookieHeader = parseCookieHeader(cookieHeader);
        return this._state.parsedCookieHeader;
    }

    /**
     * The loader context may accumulate some headers we'd like to add to the final
     * response. Our HTTP request handler is expected to call this function to add
     * these headers.
     */
    public addResponseHeaders(headers: Headers) {
        if (this._state.addResponseHeaders !== null) {
            for (const add of this._state.addResponseHeaders) {
                add(headers);
            }
        }
    }

    /**
     * We store a persistent identifier for the user's web browser in a cookie.
     * This way we can associate state and analytics with that browser.
     *
     * This function gets that identifier and generates a new one if the identifier
     * doesn't already exist.
     */
    public getBrowserId(): BrowserId {
        if (!this._state.browserId) {
            const browserIdCookieString = this._parseCookieHeader()?.["browser"];

            let browserId: BrowserId;
            let shouldSetBrowserIdCookie: boolean;
            if (!browserIdCookieString) {
                browserId = generateId();
                shouldSetBrowserIdCookie = true;
            } else {
                const [browserIdPart, datePart] = browserIdCookieString.split("@", 2);
                const date = datePart ? parseISO(datePart) : null;
                if (browserIdPart && isId<BrowserId>(browserIdPart) && date && isValidDate(date)) {
                    browserId = browserIdPart;
                    // Reset the `BrowserId` cookie every 10 days. Chrome doesn't let cookies live
                    // for longer than 400 days in the future. As long as the user is actively
                    // using our service we want to make sure their `BrowserId` cookie is
                    // maintained.
                    shouldSetBrowserIdCookie = differenceInDays(new Date(), date) >= 10;
                } else {
                    browserId = generateId();
                    shouldSetBrowserIdCookie = true;
                }
            }

            if (shouldSetBrowserIdCookie) {
                this._state.addResponseHeaders ??= [];
                this._state.addResponseHeaders.push(headers => {
                    headers.append(
                        "set-cookie",
                        serializeSetCookieHeader(
                            "browser",
                            `${browserId}@${new Date().toISOString()}`,
                            {
                                // The session cookie domain is not set in development because we may be
                                // accessing from a proxied domain or an IP address on a mobile device.
                                domain:
                                    process.env.NODE_ENV === "production"
                                        ? "cyberworlds.dev"
                                        : undefined,
                                httpOnly: true,
                                path: "/",
                                sameSite: "lax",
                                // Only allow the session cookie to be sent over HTTPS in production. In
                                // development we use plain HTTP.
                                secure: process.env.NODE_ENV === "production",
                                maxAge: 60 * 60 * 24 * 365, // 1 year
                            },
                        ),
                    );
                });
            }

            this._state.browserId = browserId;
        }

        return this._state.browserId;
    }

    /**
     * Information about the client available on the server. For example client
     * screen size and client locale. On our first request we will guess client
     * info from the user agent. When the client loads it will write its actual
     * information to a cookie.
     */
    public getClientInfo(): ClientInfo {
        if (!this._state.clientInfo) {
            const userAgentHeader = this._request.headers.get("user-agent") ?? "";

            const clientInfoCookieString = this._parseCookieHeader()?.["client-info"];

            let clientInfo;
            if (clientInfoCookieString) {
                try {
                    const rawClientInfo = JSON.parse(clientInfoCookieString);

                    // NOTE(calebmer, 2023-12-14): Client info cookies before this date won't have
                    // `isAppleDevice`. Add it with a default value based on the `User-Agent` header.
                    rawClientInfo.isAppleDevice ??= isAppleDeviceUserAgent(userAgentHeader);

                    clientInfo = ClientInfoSchema.deserialize(rawClientInfo);
                } catch {
                    // Ignore any errors when parsing the client info cookie.
                }
            }

            if (!clientInfo) {
                // Device detection with user-agent parsing is generally bad and should be
                // avoided. However, in the case where we don't yet have a client info cookie
                // we use the user agent as a hint to determine what our default when
                // server-side rendering should be. We have logic on the client to heal the
                // cookie if we guess wrong. The user will see a quick flash of content but
                // that's all.
                //
                // [MDN recommends testing for the string "Mobi" to tell if we are on a
                // mobile device][1].
                //
                // This should also pass if the string `CyberworldsNativeMobileIos` or
                // `CyberworldsNativeMobileAndroid` is included. Which represents a request
                // from our native iOS app. (Both strings contain "Mobi".)
                //
                // [1]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#mobile_tablet_or_desktop
                if (/Mobi/i.test(userAgentHeader)) {
                    clientInfo = defaultMobileClientInfo;
                } else {
                    clientInfo = defaultClientInfo;
                }

                // Update the default `clientInfo` with `isAppleDevice` based on the
                // `User-Agent` header.
                clientInfo = {
                    ...clientInfo,
                    isAppleDevice: isAppleDeviceUserAgent(userAgentHeader),
                };
            }

            // We can safely look for `CyberworldsNativeMobile` in the user agent since
            // it's a unique string that should only be used by our native app shells.
            if (/CyberworldsNativeMobile/.test(userAgentHeader) && !clientInfo.isNativeMobile) {
                clientInfo = {
                    ...clientInfo,
                    isNativeMobile: true,
                };
            }

            this._state.clientInfo = clientInfo;
        }

        return this._state.clientInfo;
    }

    /**
     * Get the initial time we use when server rendering our app. We'll update the
     * time on the client as time passes.
     */
    public getInitialTime() {
        return (this._state.initialTime ??= new Date());
    }
}
