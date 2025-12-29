import type {Platform} from "~/shared/design/core/platform.js";
import type {RouteLayout} from "~/shared/design/core/route_layout.js";
import type {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import type {DateString} from "~/shared/helpers/date/date_string.js";
import {
    AccountId,
    ApnsConnectionId,
    BotId,
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    NotificationEventId,
    PeekId,
    PostId,
    RealmId,
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
    TraceId,
    TraceSpanId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import type {TracerEventHttpHeaderName} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import type {TracerEventHttpSearchParamName} from "~/shared/tracer/helpers/tracer_event_http_search_param_name.js";

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

export type TracerEventExceptionDataBase = {
    /** The type of an exception. Always one of our `ErrorCode` types. */
    readonly type?: string;

    /** Is this a system error? `true` if yes, undefined if not. */
    readonly isSystem?: true;

    /** The exception message. */
    readonly message?: string;

    /** A stack trace for our error. */
    readonly stacktrace?: string;

    /** The `ErrorDisplayMessage` if one exists with any sensitive text redacted. */
    readonly displayMessage?: string;
};

export type TracerEventExceptionDataBaseWithCause = TracerEventExceptionDataBase & {
    /**
     * If this error was caused by another error, we'll include the cause's
     * information here nested underneath. Can include up to two causes.
     */
    readonly cause?: TracerEventExceptionDataBase & {
        readonly cause?: TracerEventExceptionDataBase;
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
            /** HTTP request headers. */
            readonly header?: {readonly [K in TracerEventHttpHeaderName]?: string | number};

            /**
             * If this request had a `Cookie` header this is an obfuscated approximation of
             * that header. Mainly we'll include the cookie names but not the cookie
             * values.
             */
            readonly obfuscatedCookieHeader?: string;
        };

        readonly response?: {
            /** HTTP response headers. */
            readonly header?: {readonly [K in TracerEventHttpHeaderName]?: string | number};

            /**
             * If this request had a `Set-Cookie` header this is an obfuscated
             * approximation of that header. Mainly we'll include the cookie names but not
             * the cookie values.
             */
            readonly obfuscatedSetCookieHeader?: string;
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

        /** HTTP URL search params. */
        readonly search?: {readonly [K in TracerEventHttpSearchParamName]?: string};

        /** The IP address of the original client behind all proxies. */
        readonly clientIp?: string;

        readonly service?: {
            /**
             * The name of the service we're sending an HTTP request to. Will match
             * `service.name` for our own services and will use some descriptive phrase for
             * third-party services.
             */
            readonly name?: string;
        };

        /**
         * The duration of the `fetch()` call. An HTTP span includes the response body
         * download and parsing time. If you want to know only the amount of network
         * time a fetch request spent you can use this field.
         *
         * This duration does not include the time it takes to download the response
         * body. This duration ends when we've received the HTTP request headers.
         *
         * If other synchronous work in the Node.js process is interrupting parsing
         * of the fetch request, this field can be useful for isolating network
         * performance.
         */
        readonly fetchDurationMs?: number;
    };

    /**
     * When an unexpected error is thrown while processing our code, we include
     * information about the exception here.
     *
     * Names use the [OpenTelemetry semantic conventions for exceptions][1].
     *
     * [1]: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/semantic_conventions/exceptions.md
     */
    readonly exception?: TracerEventExceptionDataBaseWithCause & {
        /**
         * Is this an original exception? True if this is the first span we're adding
         * this exception to and undefined if this exception has been propagated.
         */
        readonly isOriginal?: true;

        /**
         * If this error was propagated (`isOriginal` is undefined) then this
         * identifies the trace/span the exception was originally thrown in.
         *
         * If `traceId` is not set but `spanId` is set then `traceId` is implicitly the
         * same as the span's `traceId`.
         *
         * If we're in a different trace then `time` will be set. `time` is the start
         * time of the original span for this exception. It's necessary to [load the
         * trace via URL][1].
         *
         * [1]: https://docs.honeycomb.io/investigate/collaborate/share-trace/
         */
        readonly original?: {
            readonly time?: DateString;
            readonly traceId?: TraceId;
            readonly spanId?: TraceSpanId;
        };

        /**
         * If this is an aggregate error then this is the first of five errors
         * included in tracing.
         */
        readonly aggregated1?: TracerEventExceptionDataBaseWithCause;

        /**
         * If this is an aggregate error then this is the second of five errors
         * included in tracing.
         */
        readonly aggregated2?: TracerEventExceptionDataBaseWithCause;

        /**
         * If this is an aggregate error then this is the third of five errors
         * included in tracing.
         */
        readonly aggregated3?: TracerEventExceptionDataBaseWithCause;

        /**
         * If this is an aggregate error then this is the fourth of five errors
         * included in tracing.
         */
        readonly aggregated4?: TracerEventExceptionDataBaseWithCause;

        /**
         * If this is an aggregate error then this is the fifth of five errors
         * included in tracing.
         */
        readonly aggregated5?: TracerEventExceptionDataBaseWithCause;
    };

    /**
     * Generic span fields unrelated to a specific sub-system in our
     * infrastructure. Useful if you're writing a one-off span and want to include
     * some data but don't want to define entirely new event data fields.
     *
     * You can't really compare these fields to each other across spans with
     * different names.
     */
    readonly common?: {
        /**
         * Some type string associated with this span. Should be low cardinality
         * (recommended below 10 values) to be useful for grouping/filtering. Often the
         * `type` property of an object we perform an `exhaustive()` switch on.
         *
         * Should be an identifier (should pass `isIdentifier()`).
         */
        readonly type?: string;

        /**
         * An identifier representing a branch of code that was executed. Should be
         * low cardinality (recommended below 10 values) to be useful for
         * grouping/filtering.
         *
         * Should be an identifier (should pass `isIdentifier()`).
         */
        readonly branch?: string;

        /**
         * A count of something related to the span. You should be able to tell what
         * the count is referring to by the span name.
         */
        readonly count?: number;

        /**
         * This span is blocking other spans in our trace. As opposed to being run in
         * parallel with other spans (e.g. via `context.process.waitUntil()` or
         * `runAllPromises()`).
         *
         * If this is set to true it implies the span could be run in parallel but in
         * this instance it's not.
         */
        readonly isBlocking?: boolean;

        /**
         * Has this span done nothing? If true this span is a noop (no operation). What
         * that means exactly depends on the context of the span.
         */
        readonly didNothing?: boolean;

        /**
         * If our span ran some process this is the duration of that process's
         * execution. Useful if your span contains other work like setup/teardown
         * before and after the process execution. Since you may use this property
         * instead of creating another span to track just the process duration.
         */
        readonly processDurationMs?: number;

        /**
         * Was the data we're loading in this span cached? True if so false if not.
         */
        readonly wasCached?: boolean;

        /**
         * Width of some geometry in whatever units are relevant to the span.
         */
        readonly width?: number;

        /**
         * Height of some geometry in whatever units are relevant to the span.
         */
        readonly height?: number;
    };

    /**
     * Information about where this event ocurred in the product. Usually set
     * in the client's web browser then propagated.
     */
    readonly context?: {
        /**
         * The nearest span name starting with `Handle:`. This property is useful for
         * grouping/filtering spans by the action in which they occur. For instance, if
         * you want to sum all DynamoDB capacity consumed by a route you would filter
         * by this handle.
         *
         * If many OpenSearch requests were being made and you wanted to see where from,
         * you'd filter by this handle.
         */
        readonly handler?: string;

        /** Information about the account who caused this event. */
        readonly accountId?: AccountId;

        /** Information about the space the event was fired while looking at. */
        readonly spaceId?: SpaceId;

        /**
         * If this action is being performed by a bot, this is the bot performing the
         * action.
         */
        readonly botId?: BotId;

        /**
         * True if this is an anonymous request. Instead of `context.accountId` this'll
         * be set when there is no authenticated account.
         */
        readonly isAnonymous?: boolean;

        /**
         * True if the actor is accessing a space (in `context.spaceId`) it doesn't
         * have access to. Will be true for anonymous requests and session actors that
         * aren't a member of the space.
         */
        readonly withoutSpaceAccess?: boolean;

        /** The WebSocket connection our event is on behalf of. */
        readonly webSocketConnectionId?: WebSocketConnectionId;

        /**
         * The ID of the peek this event is coming from. May be accompanied by some
         * `peek` properties.
         */
        readonly peekId?: PeekId;

        /** Information about the task the event was fired while looking at. */
        readonly taskId?: TaskId;

        /** Information about the task collection the event was fired while looking at. */
        readonly taskCollectionId?: TaskCollectionId;

        // The below IDs can be rendered in a peek so they should also be included in
        // `peek.context` to disambiguate between whether they are the primary content
        // or peek content for our event.

        /** Information about the document the event was fired while looking at. */
        readonly documentId?: DocumentId;

        /** Information about the channel the event was fired while looking at. */
        readonly channelId?: ChannelId;

        /** Information about the post the event was fired while looking at. */
        readonly postId?: PostId;

        /** Information about the chat the event was fired while looking at. */
        readonly chatId?: ChatId;

        /** This event involves the file with the following ID. */
        readonly fileId?: FileId;

        /**
         * If this event is coming from a peek then this object will be populated with
         * information about the peek.
         *
         * IDs will be moved from the parent context into this object to disambiguate
         * them. So if your peek is looking at a document and the peek is rendered on
         * top of a document `context.documentId` will be the document ID in the peek
         * you're directly interacting with whereas `context.peek.aboveDocumentId` will
         * be the document ID the peek is rendered on top of.
         */
        readonly peek?: {
            /** Information about the document the peek the event is coming from is above. */
            readonly aboveDocumentId?: DocumentId;

            /** Information about the channel the peek the event is coming from is above. */
            readonly aboveChannelId?: ChannelId;

            /** Information about the post the peek the event is coming from is above. */
            readonly abovePostId?: PostId;

            /** Information about the chat the peek the event is coming from is above. */
            readonly aboveChatId?: ChatId;
        };

        /**
         * Is this span a part of a migration? If so this is the migration name.
         */
        readonly migration?: string;

        /**
         * Route we're rendering in `AppService`.
         */
        readonly route?: string;

        /**
         * What platform are we rendering on? Desktop or mobile.
         */
        readonly platform?: Platform;

        /**
         * What spacing scale are we using to render?
         */
        readonly spacingScale?: SpacingScale;

        /**
         * What route layout are we rendering in? Full (desktop) or narrow (mobile and
         * peeks).
         */
        readonly routeLayout?: RouteLayout;

        /**
         * The browser rendering engine being used to render the app.
         */
        readonly renderingEngine?: string;
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
            readonly [tableName: string]:
                | {
                      readonly readCapacityUnits?: number;
                      readonly writeCapacityUnits?: number;
                  }
                // TypeScript needs this to consider `readCapacityUnits` and
                // `writeCapacityUnits` so the type when accessing an index prop is correct.
                | number
                | undefined;

            /** The total number of read capacity units consumed by this operation. */
            readonly totalReadCapacityUnits?: number;

            /** The total number of write capacity units consumed by this operation. */
            readonly totalWriteCapacityUnits?: number;
        };

        /**
         * Information about the items DynamoDB is accessing with this action. DynamoDB
         * could be accessing many different item types from many different tables.
         */
        readonly table?: {
            readonly [tableName: string]: {
                /**
                 * What partition type in the provided table are we accessing? If we're
                 * accessing multiple partition types they'll be combined together with
                 * a `+`.
                 */
                readonly partitionType?: string;

                /**
                 * Information about the partitions in our table DynamoDB is accessing.
                 */
                readonly partition?: {
                    readonly [partitionType: string]: {
                        /**
                         * What sort range type in the provided table's partition are we accessing? If
                         * we're accessing multiple sort range types they'll be combined together with
                         * a `+`.
                         */
                        readonly sortRangeType: string;
                    };
                };
            };
        };

        /**
         * If this is a conditional write then this is the condition expression.
         *
         * Condition expressions never contain values, only variable substitutions.
         */
        readonly conditionExpression?: string;

        /**
         * The update expression for an `UpdateItem` action.
         */
        readonly updateExpression?: string;

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
             * The number of items in the transaction. May be longer than the `items` array
             * if we weren't able to summarize a transaction item.
             */
            readonly itemCount?: number;

            /**
             * The client request token for the transaction. The client request token is
             * used for executing idempotent transactions.
             */
            readonly clientRequestToken?: string;
        };

        /** Information regarding a DynamoDB read transaction. */
        readonly transactGet?: {
            /** The number of items requested by the transaction. */
            readonly size?: number;
        };

        /** Information about an exception from DynamoDB itself. */
        readonly exception?: {
            /** The DynamoDB exception type. */
            readonly type?: string;

            /** JSON string of cancellation reasons associated with a transaction failure. */
            readonly cancellationReasons?: string;
        };
    };

    /**
     * Information regarding AWS services.
     *
     * For legacy reasons `dynamodb` is not in here. We created `dynamodb`
     * attributes before we had this `aws` namespace.
     */
    readonly aws?: {
        /** Information associated with AWS credentials. */
        readonly credentials?: {
            /** The time at which our credentials session token is set to expire. */
            readonly expirationTime?: DateString;
        };

        /**
         * Information regarding our use of Amazon SES for sending email.
         */
        readonly ses?: {
            /** The AWS SES message id. Can be used to track deliverability status. */
            readonly messageId?: string;
        };

        /**
         * Information regarding our use of Amazon SQS for processing message queues.
         */
        readonly sqs?: {
            /**
             * The name of the Amazon SQS queue. Derived from the queue URL.
             */
            readonly queueName?: string;

            /**
             * The ID of the message generated by SQS. Can be used for tracking the message
             * around our systems.
             */
            readonly messageId?: string;

            /** The SQS visibility timeout for messages in seconds. */
            readonly visibilityTimeout?: number;

            /** The SQS timeout for a `ReceiveMessage` action in seconds. */
            readonly waitTimeSeconds?: number;

            /** The max number of messages a `ReceiveMessage` call can return. */
            readonly maxNumberOfMessages?: number;

            /** The number of messages involved in this SQS action. */
            readonly messageCount?: number;

            /** The approximate number of times the message has been received by a queue consumer. Roughly equivalent to retry count. */
            readonly approximateReceiveCount?: number;
        };

        /**
         * Information regarding AWS Elastic Container Service (ECS) which is AWS's
         * version of Kubernetes.
         */
        readonly ecs?: {
            /**
             * The name of the ECS cluster we're operating against.
             */
            readonly cluster?: string;

            /**
             * The name of the ECS task definition family we're operating against.
             */
            readonly taskDefinitionFamily?: string;

            /**
             * The number of tasks our ECS operation is dealing with.
             */
            readonly taskCount?: number;

            /**
             * The number of container instances our ECS operation is dealing with.
             */
            readonly containerInstanceCount?: number;
        };

        /**
         * Information regarding AWS CloudFormation templated deploys.
         */
        readonly cloudformation?: {
            /** The CloudFormation logic ID for a resource. */
            readonly logicalResourceId?: string;

            /** The actual AWS ID for a resource. */
            readonly physicalResourceId?: string;

            /** What type of AWS resource is this referring to? */
            readonly resourceType?: string;

            /** Status from the activity event which marks a resource as started deploying. */
            readonly startStatus?: string;

            /** Reason from the activity event which marks a resource as started deploying. */
            readonly startStatusReason?: string;

            /** Status from the activity event which marks an error deploying a resource. */
            readonly errorStatus?: string;

            /** Reason from the activity event which marks an error deploying a resource. */
            readonly errorStatusReason?: string;

            /** Status from the activity event which marks a resource as finished deploying. */
            readonly finishStatus?: string;

            /** Reason from the activity event which marks a resource as finished deploying. */
            readonly finishStatusReason?: string;
        };

        /**
         * Information regarding AWS EventBridge.
         */
        readonly eventbridge?: {
            /**
             * Information regarding the AWS EventBridge Scheduler.
             */
            readonly scheduler?: {
                /** The schedule name we're operating on. */
                readonly name?: string;

                /** The group the schedule we're operating on is a part of. */
                readonly groupName?: string;

                /** A human-readable description of the target EventBridge will update. */
                readonly target?: string;

                /** The schedule ARN for finding and updating it in AWS. */
                readonly arn?: string;

                /** The expression we assign to the schedule we're operating on. */
                readonly expression?: string;

                /** The time zone to use when interpreting the schedule expression. */
                readonly expressionTimeZone?: string;

                /**
                 * If a flexible time window is enabled, the maximum amount of time in
                 * minutes after the schedule is fired EventBridge can send an event to the
                 * target.
                 */
                readonly maxFlexibleTimeWindowMinutes?: number;

                /** When does the schedule start running? */
                readonly startDate?: DateString;

                /** When does the schedule stop running? */
                readonly endDate?: DateString;
            };
        };

        /**
         * Information regarding AWS EC2.
         */
        readonly ec2?: {
            /** A EC2 security group ID related to this span. */
            readonly securityGroupId?: string;

            /** The number of EC2 instances related to this span. */
            readonly instanceCount?: number;
        };
    };

    readonly email?: {
        /** Which of our email templates are we using? */
        readonly template?: string;
        /** The email address we are sending from. */
        readonly source?: string;
    };

    readonly webSocket?: {
        /**
         * The ID of the connection our event is about.
         *
         * There's also a `context.webSocketConnectionId` property so how do you tell
         * which one to use? When there are two WebSockets involved in an operation the
         * distinction is useful. For example, if one WebSocket is sending another an
         * event then `context.webSocketConnectionId` will be the sender (the WebSocket
         * taking the action) and `webSocket.connectionId` will be the receiver (the
         * WebSocket receiving the event).
         *
         * We recommend adding `webSocket.connectionId` to any direct WebSocket
         * operation even when it's redundant with `context.webSocketConnectionId` for
         * consistency. That way you can filter on `webSocket.connectionId` to see all
         * of a WebSocket's activity.
         */
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

    /** Information regarding the processing of our generic content data type. */
    readonly content?: {
        /** Information regarding collaborative content editing. */
        readonly collaborative?: {
            /** The actual version of the collaborative content. */
            readonly version?: number;

            /**
             * The starting version (inclusive) in some collaborative content operation's
             * version range.
             */
            readonly startVersion?: number;

            /**
             * The ending version (exclusive) in some collaborative content operation's
             * version range.
             */
            readonly endVersion?: number;

            /** The number of steps added in an update. */
            readonly stepCount?: number;

            /** The version of the collaborative content according to the client. */
            readonly clientVersion?: number;

            /** The number of steps the client tries to add in an update. */
            readonly clientStepCount?: number;
        };
    };

    /** Information regarding the event being processed. */
    readonly notifications?: {
        /** What is the notification event we are describing? */
        readonly eventType?: string;

        /** The ID of the notification we are processing. */
        readonly eventId?: NotificationEventId;

        readonly emailDigest?: {
            /** The reason an account was ineligible for a digest notification. Will be null if the account is eligible. */
            readonly ineligibleReason?: string;

            /** The time a digest notification is supposed to be sent. */
            readonly sendTime?: DateString;
        };
    };

    /** Information regarding the task product surface. */
    readonly tasks?: {
        /**
         * Description for the action transaction we are processing. A list of
         * comma separated action labels.
         */
        readonly actions?: string;

        /**
         * The number of actions our event is dealing with. For example:
         *
         * - The number of actions in an action transaction
         * - The number of actions in an action history iteration
         */
        readonly actionCount?: number;

        /** The action transaction we're operating against. */
        readonly actionTransactionId?: TaskActionTransactionId;

        /** The number of action transactions we are iterating over. */
        readonly actionTransactionCount?: number;

        /** The number of action history segments we are iterating over. */
        readonly actionHistorySegmentCount?: number;
    };

    /** Data related to requests to OpenSearch. */
    readonly opensearch?: {
        /** Routing key for the document. */
        readonly routing?: string;

        /**
         * A JSON string representation of a search's query. User data in the query is
         * replaced with `_`.
         */
        readonly query?: string;

        /** A JSON string representation of a search's sorts. */
        readonly sort?: string;

        /** Information regarding an OpenSearch get document request. */
        readonly get?: {
            /** Was the document found? */
            readonly found?: boolean;

            /** ID of the document. */
            readonly id?: string;

            /**
             * The document's `_seq_no` property used for optimistic concurrency control.
             */
            readonly seqNo?: number;

            /**
             * The document's `_primary_term` property used for optimistic concurrency
             * control.
             */
            readonly primaryTerm?: number;
        };

        /** Information regarding an OpenSearch multi-get document request. */
        readonly mget?: {
            /** How many documents were requested? */
            readonly count?: number;

            /**
             * The routing keys for the requested documents joined by commas. Only present
             * if there's not one singular routing value for all the documents we're
             * loading.
             */
            readonly routings?: string;

            /** IDs of the documents. */
            readonly ids?: string;

            /** How many documents were found? */
            readonly foundCount?: number;

            /**
             * The `_seq_no` property of the returned documents joined by commas.
             */
            readonly seqNos?: string;

            /**
             * The `_primary_term` property of the returned documents joined by commas.
             */
            readonly primaryTerms?: string;
        };

        /** Information regarding an OpenSearch index request. */
        readonly index?: {
            /** ID of the document. */
            readonly id?: string;

            /**
             * If we're using optimistic concurrency control, the `_seq_no` property of the
             * document must match or else we'll reject the update.
             */
            readonly ifSeqNo?: number;

            /**
             * If we're using optimistic concurrency control, the `_primary_term` property of
             * the document must match or else we'll reject the update.
             */
            readonly ifPrimaryTerm?: number;

            /**
             * The document's new `_seq_no` property used for optimistic concurrency
             * control.
             */
            readonly seqNo?: number;

            /**
             * The document's new `_primary_term` property used for optimistic concurrency
             * control.
             */
            readonly primaryTerm?: number;
        };

        /** Information regarding an OpenSearch bulk request. */
        readonly bulk?: {
            /** How many bulk operations were made? */
            readonly count?: number;

            /**
             * The routing keys for the requested documents joined by commas. Only present
             * if there's not one singular routing value for all the documents we're
             * loading.
             */
            readonly routings?: string;

            /** IDs of the documents. */
            readonly ids?: string;

            /** The actions from the bulk update separated by commas. */
            readonly actions?: string;

            /**
             * If we're using optimistic concurrency control, the `_seq_no` property of the
             * command must match or else we'll reject the update (null if there is no
             * `_seq_no`).
             */
            readonly ifSeqNos?: string;

            /**
             * If we're using optimistic concurrency control, the `_primary_term` property of
             * the command must match or else we'll reject the update (null if there is no
             * `_primary_term`).
             */
            readonly ifPrimaryTerms?: string;

            /**
             * The document's new `_seq_no` property used for optimistic concurrency
             * control.
             */
            readonly seqNos?: string;

            /**
             * The document's new `_primary_term` property used for optimistic concurrency
             * control.
             */
            readonly primaryTerms?: string;
        };

        /** Information regarding an OpenSearch search request. */
        readonly search?: {
            /** How many hits were returned by the search? */
            readonly hitCount?: number;
        };
    };

    /**
     * Information pertaining to our job queue system in `server/jobs`.
     */
    readonly jobs?: {
        /** What type of job is this? */
        readonly type?: string;

        /** What's the name of the queue this job is a part of? */
        readonly queueName?: string;

        /**
         * How long was the delay for this job before it starts processing?
         */
        readonly delaySeconds?: number;

        /**
         * How long was this job idle in the queue before we picked it up for
         * processing?
         *
         * Excludes `delaySeconds` since that's an intentional delay. The true amount
         * of time the job spent in the queue is `queueDurationMs` + `delaySeconds`.
         */
        readonly queueDurationMs?: number;

        /**
         * Will we retry this job? True if the job threw an error. You can't look at
         * whether our span has an `exception.type` attribute to know if the job will
         * retry. Since sometimes we add an exception to jobs that are considered
         * completed (e.g. if we fail to process a corrupt file in the `ProcessFile`
         * job we'll add the processing error to the job span but won't retry the job.)
         */
        readonly willRetry?: boolean;

        /**
         * Information pertaining to `JobQueueConsumer`.
         */
        readonly consumer?: {
            /**
             * The number of running fibers in `JobQueueConsumer` at the start of the span.
             */
            readonly startFiberCount?: number;

            /**
             * The number of running fibers in `JobQueueConsumer` at the end of the span.
             */
            readonly endFiberCount?: number;

            /**
             * The maximum number of fibers in `JobQueueConsumer` can run at the same time.
             */
            readonly maxFiberCount?: number;
        };
    };

    /**
     * Information related to requests made to Cohere's API.
     */
    readonly cohere?: {
        /** How many texts were passed into the Cohere embedding API? */
        readonly textCount?: number;

        /** What Cohere model did we use? */
        readonly model?: string;

        /** What input type did we use for the Cohere embedding? */
        readonly inputType?: string;

        /** How many tokens were we billed for this Cohere embedding API request? */
        readonly tokenCount?: number;
    };

    /**
     * When running a migration with our migration service we record useful
     * information in this namespace.
     */
    readonly migration?: {
        /** If this is a migration that runs in parallel, what segment are we in? */
        readonly segmentIndex?: number;

        /** How many total segments are running as a part of this migration? */
        readonly totalSegmentCount?: number;
    };

    /**
     * Information related to requests made to Apple Push Notification service
     * (APNs). APNs uses the HTTP/2 protocol so a lot of data relate to APNs is
     * stored in `http` tracer data. Particularly `http.request.headers` and
     * `http.response.headers`.
     */
    readonly apns?: {
        /**
         * The ID we assigned to the APNs HTTP/2 connection.
         */
        readonly connectionId?: ApnsConnectionId;

        /**
         * Reason for a non-200 status code from APNs. Error reason strings are
         * documented [here][1].
         *
         * [1]: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns#Understand-error-codes
         */
        readonly errorReason?: string;
    };

    readonly webPush?: {
        /** The origin of the web push service subscription endpoint like `https://fcm.googleapis.com` */
        readonly subscriptionEndpointOrigin?: string;

        /** The ID of the browser we're sending the notification to. */
        readonly browserId?: string;

        /** The status code of the response from the web push service. */
        readonly responseStatusCode?: number;
    };

    /**
     * Any data related to Cloudflare services.
     */
    readonly cloudflare?: {
        /**
         * Information related to [Cloudflare R2][1]. Cloudflare's AWS S3
         * compatible object storage service.
         *
         * [1]: https://developers.cloudflare.com/r2/
         */
        readonly r2?: {
            /** The Cloudflare R2 action being executed. */
            readonly action?: string;

            /** The Cloudflare R2 bucket being accessed or modified. */
            readonly bucket?: string;

            /** Information about a single Cloudflare R2 object. */
            readonly object?: {
                /** The Cloudflare R2 object key being accessed or modified. */
                readonly key?: string;

                /** The content type of our Cloudflare R2 object. */
                readonly contentType?: string;

                /** The content length of our Cloudflare R2 object. */
                readonly contentLength?: number;
            };

            /** Information regarding a Cloudflare R2 multipart upload. */
            readonly multipartUpload?: {
                /** The ID of the Cloudflare multipart upload this is a part of. */
                readonly id?: string;

                /** What's the number of this part in the multipart upload? */
                readonly partNumber?: number;

                /** What's the length of this part in the multipart upload in bytes? */
                readonly partContentLength?: number;

                /** What's the total number of parts in this multipart upload? */
                readonly totalPartCount?: number;
            };
        };

        /**
         * Information related to our use of Cloudflare Wrangler for deploying
         * Cloudflare Workers.
         */
        readonly wrangler?: {
            /** The attempt number of a Cloudflare Wrangler deployment. */
            readonly attempt?: number;
        };
    };

    /**
     * Any data related to GitHub services.
     */
    readonly github?: {
        /**
         * A URL pointing to a GitHub repo's `/compare` route for easy comparing of two
         * commits.
         */
        readonly compareUrl?: string;

        /** Information related to a GitHub action. */
        readonly workflow?: {
            /** Information related to a GitHub action run. */
            readonly run?: {
                /** The ID of a GitHub action run. */
                readonly id?: number;

                /** The number of this GitHub action run. */
                readonly number?: number;

                /** The attempt number of a GitHub action run. */
                readonly attempt?: number;

                /** The URL to the GitHub UI for a GitHub action run. */
                readonly url?: string;

                /** The commit this GitHub workflow is running against. */
                readonly commit?: string;
            };
        };
    };

    /**
     * Any data related to our `DeployService`'s deploy script. Most data related
     * to a deploy can be found in `github.workflow.run` but there's some workflow
     * agnostic data we want to record.
     */
    readonly deploy?: {
        /** Represents the active commit. */
        readonly activeCommit?: string;

        /** Represents the commit for an ongoing deployment. */
        readonly ongoingDeploymentCommit?: string;

        /** Represents the commit for a dispatched deployment. */
        readonly dispatchedDeploymentCommit?: string;

        /** Represents the new commit we're trying to deploy. */
        readonly newCommit?: string;

        /**
         * The timestamp with time zone we use for determining `isTimeDeployable`.
         */
        readonly zonedTime?: string;

        /**
         * Is `zonedTime` a time when we can run a deploy? True if its work hours on
         * a weekday.
         */
        readonly isTimeDeployable?: boolean;
    };

    /**
     * Information regarding files uploaded to our product.
     */
    readonly file?: {
        /** The content type of the file we're operating against. */
        readonly contentType?: string;

        /** The content length of the file we're operating against. */
        readonly contentLength?: number;

        /** What type of processor are we using for this content? */
        readonly processorType?: string;

        /** What type of job are we using for this content, heavy or light? */
        readonly jobType?: string;

        /** The reason the job was sent to the job type. */
        readonly jobReason?: string;

        /** The creation time of the file in epoch milliseconds. */
        readonly createdTime?: string;

        readonly alternative?: {
            /** The content type of the file's alternative. */
            readonly contentType?: string;

            /** The content length of the file's alternative. */
            readonly contentLength?: number;

            /**
             * The ratio of the file alternative's content length to the file's own
             * content length.
             * (lower is better)
             */
            readonly contentLengthRatio?: number;
        };

        readonly preview?: {
            /** The content type of the file's preview. */
            readonly contentType?: string;

            /** The content length of the file's preview. */
            readonly contentLength?: number;

            /**
             * The ratio of the file preview's content length to the file's own
             * content length.
             */
            readonly contentLengthRatio?: number;

            /** The width of the file preview image. */
            readonly imageWidth?: number;

            /** The height of the file preview image. */
            readonly imageHeight?: number;

            /** The scale of the file preview image. */
            readonly imageScale?: number;

            /** Does the image have an alpha channel? */
            readonly imageHasAlpha?: boolean;

            /** If this is a video, how long is the video in milliseconds? */
            readonly imageVideoDurationMs?: number;

            /** If this is audio, how long is the audio in milliseconds? */
            readonly audioDurationMs?: number;

            /** If this is code, how long is the `FileCodePreviewContent` binary data? */
            readonly codeContentLength?: number;
        };

        /**
         * Information from `FileProcessorService` typically concerning processing
         * state.
         */
        readonly processing?: {
            /**
             * The duration of the alternative file processing. Notably not the duration of
             * the alternative content.
             */
            readonly alternativeDurationMs?: number;
            readonly imagePreviewSizeDurationMs?: number;
            readonly imagePreviewPlaceholderDurationMs?: number;
            readonly imagePreviewContentDurationMs?: number;
            readonly imagePreviewVideoDurationDurationMs?: number;
            readonly audioPreviewDurationDurationMs?: number;
            readonly audioPreviewMetadataDurationMs?: number;
            readonly codePreviewContentDurationMs?: number;

            /**
             * The ratio of the original file's duration to the file's processing duration.
             * Answers the question: "For every second of the video, how many seconds does
             * it take to process?".
             * So if a 10 second video takes 40 seconds to process, this will be 0.25.
             * If a 10 second video takes 5 seconds to process, this willbe 2.
             * (higher is better)
             */
            readonly imagePreviewVideoDurationToAlternativeProcessingDurationRatio?: number;
        };

        readonly avatar?: {
            readonly resize?: {
                /** The sharp quality used to resize and encode the Avatar. */
                readonly quality?: number;

                /** The content length of the avatar. */
                readonly resizedContentLength?: number;

                /** The ratio of the avatar's content length to the file's own content length. */
                readonly resizedToOriginalContentLengthRatio?: number;

                readonly request?: {
                    /** The requested height of the avatar in pixels (ie 72). */
                    readonly height?: number;

                    /** The requested width of the avatar in pixels (ie 72). */
                    readonly width?: number;

                    /** The target content length of the avatar. */
                    readonly maxContentLength?: number;
                };
            };
        };
    };

    readonly space?: {
        readonly members?: {
            readonly invite?: {
                /* Information about an individual invite to a space */
                readonly send?: {
                    readonly existingAccountId?: AccountId;
                    readonly newAccountId?: AccountId;
                };

                /* Counts of results from bulk invite */
                readonly invalidEmailAddressCount?: number;
                readonly rejectedAsSpamEmailAddressCount?: number;
                readonly alreadyMemberEmailAddressCount?: number;
                readonly invitedEmailAddressCount?: number;
                readonly unexpectedFailureEmailAddressCount?: number;
            };
        };
    };

    /**
     * Information regarding an execution of the [LibreOffice][1] CLI.
     *
     * [1]: https://www.libreoffice.org
     */
    readonly libreoffice?: {
        /**
         * The [output filter][1] used when running the LibreOffice binary with `--convert-to`.
         *
         * [1]: https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html
         */
        readonly outputFilter?: string;
    };

    /**
     * Information regarding an execution of FFmpeg or FFprobe.
     */
    readonly ffmpeg?: {
        /**
         * The codecs implicated in a call to FFmpeg. In the order provided by the
         * file. When there are multiple codecs they're separated by a `/`.
         */
        readonly codecs?: string;
    };

    readonly sharp?: {
        readonly avif?: {
            /** The quality used to resize and encode the file. */
            readonly quality?: number;

            /** The effort (compression efficiency) used to resize and encode the file. */
            readonly effort?: number;
        };

        /** The content length of the input file. */
        readonly inputContentLength?: number;

        /** The content length of the output file. */
        readonly outputContentLength?: number;
    };

    readonly edge?: {
        /** How long did the request to `AppService` from `EdgeService` take? */
        readonly appServiceDurationMs?: number;
    };

    /**
     * Information regarding requests to the OpenAI API.
     */
    readonly openai?: {
        /** The OpenAI model used. */
        readonly model?: string;

        /**
         * Information from the [OpenAI response API][1]. See the response API
         * documentation for what these fields mean.
         *
         * [1]: https://platform.openai.com/docs/api-reference/responses/create
         */
        readonly responses?: {
            readonly id?: string;
            readonly promptCacheKey?: string;
            readonly safetyIdentifier?: string;
            readonly status?: string;
            readonly incompleteDetails?: {reason?: string};
            readonly usage?: {
                readonly inputTokens?: number;
                readonly cachedInputTokens?: number;
                readonly outputTokens?: number;
                readonly reasoningOutputTokens?: number;
                readonly totalTokens?: number;
            };
        };
    };

    readonly agents?: {
        schedule: {
            event: {
                time?: DateString;
                executionTime?: DateString;
                queueDurationMs?: number;
                type?: string;
            };
        };
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
