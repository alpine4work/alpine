import type {Id} from "~/shared/id/id";
import type {TracerEventHttpHeaderName} from "~/shared/tracer/helpers/tracer_event_http_header_names";

/**
 * The data present in an event logged by our tracer.
 */
export type TracerEventData = {
    /**
     * General network connection attributes.
     *
     * We use the [conventional OpenTelemetry network attribute names][1] but
     * in camelCase. We convert all keys to snake_case before sending to telemetry
     * services.
     *
     * [1]: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/semantic_conventions/span-general.md
     */
    readonly net?: {
        readonly host?: {
            /** Name of the local HTTP server that received the request. */
            readonly name?: string;

            /**
             * Port of the local HTTP server that received the request.
             *
             * String since doing statistics on port doesn't really make sense.
             */
            readonly port?: string;
        };

        readonly peer?: {
            /** Remote socket peer name. */
            readonly name?: string;

            /**
             * Remote socket peer port.
             *
             * String since doing statistics on port doesn't really make sense.
             */
            readonly port?: string;
        };

        readonly sock?: {
            /**
             * Protocol [address family][1] which is used for communication (e.g. `inet`,
             * `inet6`).
             *
             * [1]: https://man7.org/linux/man-pages/man7/address_families.7.html
             */
            readonly family?: string;

            readonly peer?: {
                /**
                 * Remote socket peer address: IPv4 or IPv6 for internet protocols, path for
                 * local communication.
                 */
                readonly addr?: string;
            };

            readonly host?: {
                /** Local socket address. Useful in case of a multi-IP host. */
                readonly addr?: string;
            };
        };
    };

    /**
     * If this event corresponds to an HTTP request, this attribute contains
     * information about that request.
     *
     * We use the [conventional OpenTelemetry HTTP attribute names][1] but
     * in camelCase. We convert all keys to snake_case before sending to telemetry
     * services.
     *
     * [1]: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/semantic_conventions/http.md
     */
    readonly http?: {
        /** HTTP request method. */
        readonly method?: string;

        /** HTTP response status code if a response was received/sent. */
        readonly statusCode?: number;

        /** Kind of HTTP protocol used (e.g. 1.0 vs 2.0). */
        readonly flavor?: string;

        /** Value of the HTTP `User-Agent` header sent by the client. */
        readonly userAgent?: string;

        readonly request?: {
            /**
             * The size of the request payload body in bytes. This is the number of bytes
             * transferred excluding headers and is often, but not always, present as the
             * `Content-Length` header. For requests using transport encoding, this should
             * be the compressed size.
             */
            readonly contentLength?: number;

            /**
             * The size of the request payload body in bytes without compression.
             */
            readonly uncompressedContentLength?: number;

            /** HTTP request headers. */
            readonly header?: {readonly [K in TracerEventHttpHeaderName]?: string};
        };

        readonly response?: {
            /**
             * The size of the response payload body in bytes. This is the number of bytes
             * transferred excluding headers and is often, but not always, present as the
             * `Content-Length` header. For requests using transport encoding, this should
             * be the compressed size.
             */
            readonly contentLength?: number;

            /**
             * The size of the response payload body in bytes without compression.
             */
            readonly uncompressedContentLength?: number;

            /** HTTP response headers. */
            readonly header?: {readonly [K in TracerEventHttpHeaderName]?: string};
        };

        /** Full HTTP request URL. */
        readonly url?: string;

        /**
         * The ordinal number of request resending attempt (for any reason, including
         * redirects).
         */
        readonly resendCount?: number;

        /** The URI scheme identifying the used protocol (e.g. `http`, `https`). */
        readonly scheme?: string;

        /**
         * The full request target as passed in a HTTP request line or equivalent.
         * (e.g. `/path/12314/?q=foobar`.)
         */
        readonly target?: string;

        /**
         * The matched route (path template in the format used by the respective
         * server framework).
         */
        readonly route?: string;

        /** The IP address of the original client behind all proxies. */
        readonly clientIp?: string;
    };

    /**
     * When an unexpected error is thrown while processing our code, we include
     * information about the exception here.
     *
     * Names use the [OpenTelemetry semantic conventions for exceptions][1].
     *
     * [1]: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/semantic_conventions/exceptions.md
     */
    readonly exception?: {
        /**
         * Should be set to true if the exception event is recorded at a point where it
         * is known that the exception is escaping the scope of the span.
         */
        readonly escaped?: boolean;

        /** The exception message. */
        readonly message?: string;

        /** A stack trace for our error. */
        readonly stacktrace?: string;

        /** The type of an exception. Always one of our `ErrorCode` types. */
        readonly type?: string;
    };

    /** Information about the account which caused this event. */
    readonly account?: {
        /** The ID of the account. */
        readonly id?: Id;
    };

    /** Information about the space the event was fired in. */
    readonly space?: {
        /** The ID of the space. */
        readonly id?: Id;
    };
};

/**
 * All data available in an event.
 *
 * Includes some properties that only the tracer may set that can't be
 * overridden.
 *
 * Any names relevant to [Honeycomb][1] need to be the same here but
 * camel case.
 *
 * [1]: https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/
 */
export type TracerEventFullData = TracerEventData & {
    /**
     * The name of the event. For spans this corresponds to the function or method
     * where the span was created. For events it's a short message.
     *
     * We recommend keeping event names low cardinality. So no interpolation of
     * user data like `Hello ${account.id}`. That way you can search for all events
     * with a given name. Or easily find the event in the codebase through a
     * string search.
     */
    readonly name?: string;

    /** How much time this event took to complete in milliseconds. */
    readonly durationMs?: number;

    readonly service?: {
        /**
         * The name of the instrumented service. This is set by the `Tracer` object and
         * can't be changed.
         */
        readonly name?: string;
    };

    readonly meta?: {
        /**
         * Configure the kind of span annotation this is in Honeycomb.
         * See: https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data
         */
        readonly annotationType?: "span_event" | "link";
    };

    /**
     * If this event is part of a distributed trace then we populate this
     * trace object.
     */
    readonly trace?: {
        /** The ID of the trace this span belongs to. */
        readonly traceId?: Id;

        /** The unique ID for each span. */
        readonly spanId?: Id;

        /** The ID of this span's parent span. */
        readonly parentId?: Id;

        readonly link?: {
            /** The span ID you wish to link to. */
            readonly spanId?: Id;

            /** The trace ID you wish to link to. */
            readonly traceId?: Id;
        };
    };

    /**
     * Information about the JavaScript runtime. Names come from the
     * [ECMAScript][1] specification.
     *
     * [1]: https://262.ecma-international.org/13.0
     */
    readonly js?: {
        /**
         * Every realm is an instance of the JavaScript platform. We give every realm
         * an ID.
         *
         * Useful for figuring out the efficacy of an in-memory cache for instance.
         */
        readonly realmId?: Id;

        /** What is the host running our JavaScript code? */
        readonly host?: TracerEventJsHost;
    };
};

/**
 * Informal name of the [host][1] running our JavaScript code.
 *
 * Hosts are:
 *
 * - `Web`: A web browser implementing the [HTML specification][2] is our host.
 * - `Node`: A process running [Node.js][3] is our host.
 * - `CloudflareWorker`: The [Cloudflare Workers][4] serverless runtime is our host.
 *
 * [1]: https://262.ecma-international.org/13.0/#sec-hosts-and-implementations
 * [2]: https://html.spec.whatwg.org
 * [3]: https://nodejs.org/en/
 * [4]: https://developers.cloudflare.com/workers/
 */
export type TracerEventJsHost = "Web" | "Node" | "CloudflareWorker";
