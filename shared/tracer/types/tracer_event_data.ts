import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    RealmId,
    SpaceId,
    TraceId,
    TraceSpanId,
    WebSocketConnectionId,
    WebSocketMessageId,
} from "~/shared/id/types/id_types";
import type {TracerEventHttpHeaderName} from "~/shared/tracer/helpers/tracer_event_http_header_names";

/**
 * All data available in an event.
 *
 * Includes some properties that only the tracer may set that can't be
 * overridden.
 *
 * Any names relevant to [Honeycomb][1] need to be the same here but
 * camel case.
 *
 * `time` is not included. The event time is sent separately from the event
 * data as the [Honeycomb events API prescribes][2].
 *
 * [1]: https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/
 * [2]: https://docs.honeycomb.io/api/events/#batched-events-body
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

    /**
     * Information regarding how the event interacts with our systems.
     */
    readonly meta?: {
        /**
         * Configure the kind of span annotation this is in Honeycomb.
         * See: https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data
         */
        readonly annotationType?: "span_event" | "link";

        /**
         * Must be set to true if this event comes from an untrusted client. If we find
         * bad actors are polluting our dataset you can use this flag to filter out
         * suspicious events.
         */
        readonly untrusted?: boolean;

        /**
         * How far offset is the client clock from the server clock? If you add
         * `time + clientTimeOffsetMs` you will get the client's time.
         */
        readonly clientTimeOffsetMs?: number;
    };

    /**
     * If this event is part of a distributed trace then we populate this
     * trace object.
     */
    readonly trace?: {
        /** The ID of the trace this span belongs to. */
        readonly traceId?: TraceId;

        /** The unique ID for each span. */
        readonly spanId?: TraceSpanId;

        /** The ID of this span's parent span. */
        readonly parentId?: TraceSpanId;

        readonly link?: {
            /** The span ID you wish to link to. */
            readonly spanId?: TraceSpanId;

            /** The trace ID you wish to link to. */
            readonly traceId?: TraceId;
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
        readonly realmId?: RealmId;

        /** What is the host running our JavaScript code? */
        readonly host?: TracerEventJsHost;

        /** The value of `process.env.NODE_ENV`. */
        readonly nodeEnv?: string;
    };
};

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
        readonly sock?: {
            /**
             * Protocol [address family][1] which is used for communication (e.g. `inet`,
             * `inet6`).
             *
             * [1]: https://man7.org/linux/man-pages/man7/address_families.7.html
             */
            readonly family?: string;

            readonly peer?: {
                /** Remote socket peer name. */
                readonly name?: string;

                /**
                 * Remote socket peer address: IPv4 or IPv6 for internet protocols, path for
                 * local communication.
                 */
                readonly addr?: string;

                /**
                 * Remote socket peer port.
                 *
                 * String since doing statistics on port doesn't really make sense.
                 */
                readonly port?: string;
            };

            readonly host?: {
                /** Name of the local HTTP server that received the request. */
                readonly name?: string;

                /** Local socket address. Useful in case of a multi-IP host. */
                readonly addr?: string;

                /**
                 * Port of the local HTTP server that received the request.
                 *
                 * String since doing statistics on port doesn't really make sense.
                 */
                readonly port?: string;
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
        /** The exception message. */
        readonly message?: string;

        /** A stack trace for our error. */
        readonly stacktrace?: string;

        /** The type of an exception. Always one of our `ErrorCode` types. */
        readonly type?: string;

        /** The `ErrorDisplayMessage` if one exists with any sensitive text redacted. */
        readonly displayMessage?: string;
    };

    /**
     * Information about where this event ocurred in the product. Usually set
     * in the client's web browser then propagated.
     */
    readonly context?: {
        /** Information about the account who caused this event. */
        readonly accountId?: AccountId;

        /** Information about the space the event was fired while looking at. */
        readonly spaceId?: SpaceId;

        /** Information about the document the event was fired while looking at. */
        readonly documentId?: DocumentId;

        /** Information about the channel the event was fired while looking at. */
        readonly channelId?: ChannelId;

        /** Information about the post the event was fired while looking at. */
        readonly postId?: PostId;
    };

    /**
     * Information regarding the execution of a DynamoDB action.
     */
    readonly dynamodb?: {
        /**
         * The DynamoDB action. We expect this to be set on every span that executes
         * a DynamoDB action.
         */
        readonly action?: string;

        /**
         * The name of the table this DynamoDB action is targeting.
         *
         * ### Batch behavior
         *
         * If this is a batch read then we will take all our table names, sort them,
         * and concatenate them with a `+`. So if you are only reading from one table
         * in the batch you get just that table name. If you are reading from two
         * tables in the batch you get `Table1+Table2`.
         *
         * We sort the names so that every combination of tables is represented by the
         * same string.
         */
        readonly tableName?: string;

        /**
         * If this was a read action, was it a consistent read?
         *
         * ### Batch behavior
         *
         * If this is a batch read action then this will be true if any of the reads in
         * the batch were consistent. Since consistent reads slow down the entire batch.
         *
         * We also happen to know that our code will separate consistent and eventual reads
         * into different batches. So "any read is consistent" usually means "every read is
         * consistent".
         */
        readonly consistentRead?: boolean;

        /**
         * Capacity units consumed by table name. We will include an entry for every
         * table in the action that consumed capacity.
         */
        readonly consumedCapacity?: {
            readonly [tableName: string]: {
                readonly readCapacityUnits?: number;
                readonly writeCapacityUnits?: number;
            };
        };

        /**
         * If this is a conditional write then this is the condition expression.
         *
         * Condition expressions never contain values, only variable substitutions.
         */
        readonly conditionExpression?: string;

        /**
         * If this is a batch action (`BatchGetItem` or `BatchWriteItem`) then how many
         * items are in the batch?
         */
        readonly batchSize?: number;

        /** Information regarding a DynamoDB query. */
        readonly query?: {
            /**
             * The expression we pass to DynamoDB. Must always include an equality term on
             * the primary key. May optionally include range terms on the sort keys.
             *
             * Expressions never include values. They always have variable substitutes
             * for values.
             */
            readonly keyConditionExpression?: string;

            /** The index name to use when querying a table. */
            readonly indexName?: string;

            /** Is this a query that's scanning forward? */
            readonly scanIndexForward?: boolean;

            /** What is the maximum number of items to return from this query? */
            readonly limit?: number;

            /**
             * Is there an exclusive start key on this query? True if we are reading the
             * next page in a query.
             */
            readonly hasExclusiveStartKey?: boolean;

            /**
             * The number of items scanned when evaluating this query. May be larger than
             * the number of items returned by the query if the query had a filter
             * expression.
             */
            readonly scannedCount?: number;
        };

        /** Information regarding a DynamoDB scan. */
        readonly scan?: {
            /** The index name to use when querying a table. */
            readonly indexName?: string;

            /** What is the maximum number of items to return from this query? */
            readonly limit?: number;

            /**
             * Is there an exclusive start key on this query? True if we are reading the
             * next page in a query.
             */
            readonly hasExclusiveStartKey?: boolean;

            /**
             * The number of items scanned when evaluating this query. May be larger than
             * the number of items returned by the query if the query had a filter
             * expression.
             */
            readonly scannedCount?: number;
        };

        /** Information regarding a DynamoDB write transaction. */
        readonly transactWrite?: {
            /**
             * A JSON object summarizing the transaction items. Does not include user
             * values from the transaction.
             */
            readonly items?: string;

            /**
             * The client request token for the transaction. The client request token is
             * used for executing idempotent transactions.
             */
            readonly clientRequestToken?: string;
        };

        /** Information about an exception from DynamoDB itself. */
        readonly exception?: {
            /** The DynamoDB exception type. */
            readonly type?: string;

            /** JSON string of cancellation reasons associated with a transaction failure. */
            readonly cancellationReasons?: string;
        };
    };

    readonly email?: {
        /** Which of our email templates are we using? */
        readonly template?: string;

        /** Information regarding our use of Amazon SES for sending email. */
        readonly ses?: {
            /** The email address we are sending from. */
            readonly source?: string;

            /** The AWS SES message id. Can be used to track deliverability status. */
            readonly messageId?: string;
        };
    };

    readonly webSocket?: {
        /** The ID of the connection our event is about. */
        readonly connectionId?: WebSocketConnectionId;

        /**
         * What is the type of the message we're processing?
         *
         * This will be the most descriptive type of the message. So if we have a
         * `Message` envelope this will be the type of the message inside. Otherwise it
         * will be a system type like `Ping`, `Pong`, or `AcknowledgeMessage`.
         */
        readonly messageType?: string;
    };
};

/**
 * `TracerEventData` should be assignable to this base type. Useful for doing
 * generic manipulation on tracer event data.
 *
 * Only supports the data types that [Honeycomb supports][1].
 *
 * [1]: https://docs.honeycomb.io/api/events/#data-types
 */
export type TracerEventDataBase = {
    [key: string]: TracerEventDataBase | string | number | boolean | undefined;
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
