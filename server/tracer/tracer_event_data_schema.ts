import {
    tracerEventDataDynamoConsumedCapacityKeys,
    tracerEventDataDynamoPartitionTypesByTableName,
} from "~/server/tracer/tracer_event_data_dynamo.js";
import {DateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {
    Schema,
    SchemaDeserializationError,
    SchemaWithOnlyDeserialization,
} from "~/shared/schema/schema.js";
import {
    TracerEventFlatData,
    convertCamelCaseToSnakeCase,
} from "~/shared/tracer/helpers/build_tracer_event_flat_data.js";
import {
    TracerEventHttpHeaderName,
    tracerEventHttpHeaderNames,
} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {
    TracerEventHttpSearchParamName,
    tracerEventHttpSearchParamNames,
} from "~/shared/tracer/helpers/tracer_event_http_search_param_name.js";
import {TracerEventDataBase, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

type TracerEventDataSchemaType<Data extends TracerEventDataBase> = {
    [Key in keyof Data]-?: NonNullable<Data[Key]> extends TracerEventDataBase
        ? TracerEventDataSchemaType<NonNullable<Data[Key]>>
        : SchemaWithOnlyDeserialization<NonNullable<Data[Key]>>;
};

type TracerEventDataSchemaBase = {
    readonly [key: string]:
        | SchemaWithOnlyDeserialization<string>
        | SchemaWithOnlyDeserialization<number>
        | SchemaWithOnlyDeserialization<boolean>
        | TracerEventDataSchemaBase;
};

const DateStringSchema = Schema.string.transform<DateString>({
    serialize: string => string,
    deserialize: string => {
        if (!isDateString(string)) throw new SchemaDeserializationError("Expected date string");
        return string;
    },
});

const TracerEventExceptionDataBaseSchema = {
    type: IdentifierStringSchema,
    isSystem: Schema.enum([true]),
    message: Schema.string,
    stacktrace: Schema.string,
    displayMessage: Schema.string,
};

/**
 * Schemas for all the properties in `TracerEventFullData`. This is in `server`
 * since we don't want it to eat into client bundle size. Likewise
 * `TracerEventFullData` is in a `types` directory so that none of its
 * dependencies are a part of client bundles.
 */
export const TracerEventDataSchema: TracerEventDataSchemaType<TracerEventFullData> = {
    name: LabelStringSchema,
    durationMs: Schema.float,
    service: {
        name: IdentifierStringSchema,
    },
    meta: {
        annotationType: Schema.enum(["span_event", "link"]),
        untrusted: Schema.boolean,
        clientTimeOffsetMs: Schema.float,
    },
    trace: {
        traceId: Schema.id(),
        spanId: Schema.id(),
        parentId: Schema.id(),
        link: {
            spanId: Schema.id(),
            traceId: Schema.id(),
        },
    },
    js: {
        realmId: Schema.id(),
        host: Schema.enum(["Web", "Node", "CloudflareWorker"]),
        nodeEnv: IdentifierStringSchema,
    },
    net: {
        sock: {
            family: IdentifierStringSchema,
            peer: {
                name: LabelStringSchema,
                addr: LabelStringSchema,
                port: LabelStringSchema,
            },
            host: {
                name: LabelStringSchema,
                addr: LabelStringSchema,
                port: LabelStringSchema,
            },
        },
    },
    http: {
        method: IdentifierStringSchema,
        statusCode: Schema.integer,
        flavor: LabelStringSchema,
        userAgent: LabelStringSchema,
        request: {
            contentLength: Schema.float,
            uncompressedContentLength: Schema.float,
            header: Object.fromEntries(
                mapIterable(tracerEventHttpHeaderNames, headerName => [
                    headerName,
                    LabelStringSchema,
                ]),
            ) as unknown as {[K in TracerEventHttpHeaderName]: Schema<string>},
            obfuscatedCookieHeader: Schema.string,
        },
        response: {
            contentLength: Schema.float,
            uncompressedContentLength: Schema.float,
            header: Object.fromEntries(
                mapIterable(tracerEventHttpHeaderNames, headerName => [
                    headerName,
                    LabelStringSchema,
                ]),
            ) as unknown as {[K in TracerEventHttpHeaderName]: Schema<string>},
            obfuscatedSetCookieHeader: Schema.string,
        },
        url: LabelStringSchema,
        resendCount: Schema.integer,
        scheme: IdentifierStringSchema,
        target: LabelStringSchema,
        route: LabelStringSchema,
        search: Object.fromEntries(
            mapIterable(tracerEventHttpSearchParamNames, searchParamName => [
                searchParamName,
                LabelStringSchema,
            ]),
        ) as unknown as {[K in TracerEventHttpSearchParamName]: Schema<string>},
        clientIp: LabelStringSchema,
        service: {
            name: Schema.string,
        },
        fetchDurationMs: Schema.float,
    },
    exception: {
        ...TracerEventExceptionDataBaseSchema,
        isOriginal: Schema.enum([true]),
        original: {
            time: DateStringSchema,
            traceId: Schema.id<TraceId>(),
            spanId: Schema.id<TraceSpanId>(),
        },
        cause: {
            ...TracerEventExceptionDataBaseSchema,
            cause: TracerEventExceptionDataBaseSchema,
        },
    },
    common: {
        count: Schema.integer,
        isBlocking: Schema.boolean,
        didNothing: Schema.boolean,
    },
    context: {
        handler: Schema.string,
        accountId: Schema.id(),
        spaceId: Schema.id(),
        webSocketConnectionId: Schema.id(),
        peekId: Schema.id(),
        taskId: Schema.id(),
        taskCollectionId: Schema.id(),
        taskNotepadPageId: Schema.integer,
        documentId: Schema.id(),
        channelId: Schema.id(),
        postId: Schema.id(),
        chatId: Schema.id(),
        fileId: Schema.id(),
        peek: {
            aboveDocumentId: Schema.id(),
            aboveChannelId: Schema.id(),
            abovePostId: Schema.id(),
            aboveChatId: Schema.id(),
        },
        migration: Schema.string,
    },
    dynamodb: {
        action: IdentifierStringSchema,
        tableName: LabelStringSchema,
        consistentRead: Schema.boolean,
        consumedCapacity: {
            ...Object.fromEntries(
                Array.from(tracerEventDataDynamoConsumedCapacityKeys, key => [
                    key,
                    {
                        readCapacityUnits: Schema.float,
                        writeCapacityUnits: Schema.float,
                    },
                ]),
            ),
            totalReadCapacityUnits: Schema.float,
            totalWriteCapacityUnits: Schema.float,
        },
        table: Object.fromEntries(
            Array.from(
                tracerEventDataDynamoPartitionTypesByTableName,
                (partitionTypes, tableName) => [
                    tableName,
                    {
                        partitionType: Schema.string,
                        partition: Object.fromEntries(
                            partitionTypes.map(partitionType => [
                                partitionType,
                                {sortRangeType: Schema.string},
                            ]),
                        ),
                    },
                ],
            ),
        ),
        conditionExpression: Schema.string,
        updateExpression: Schema.string,
        batchSize: Schema.integer,
        query: {
            keyConditionExpression: Schema.string,
            indexName: IdentifierStringSchema,
            scanIndexForward: Schema.boolean,
            limit: Schema.integer,
            hasExclusiveStartKey: Schema.boolean,
            scannedCount: Schema.integer,
        },
        scan: {
            indexName: IdentifierStringSchema,
            limit: Schema.integer,
            hasExclusiveStartKey: Schema.boolean,
            scannedCount: Schema.integer,
        },
        transactWrite: {
            items: Schema.string,
            itemCount: Schema.integer,
            clientRequestToken: Schema.string,
        },
        transactGet: {
            size: Schema.integer,
        },
        exception: {
            type: LabelStringSchema,
            cancellationReasons: Schema.string,
        },
    },
    aws: {
        credentials: {
            expirationTime: DateStringSchema,
        },
        ses: {
            source: LabelStringSchema,
            messageId: Schema.string,
        },
        sqs: {
            messageId: Schema.string,
        },
        ecs: {
            cluster: Schema.string,
            taskDefinitionFamily: Schema.string,
            taskCount: Schema.integer,
            containerInstanceCount: Schema.integer,
        },
        cloudformation: {
            logicalResourceId: Schema.string,
            physicalResourceId: Schema.string,
            resourceType: Schema.string,
            startStatus: IdentifierStringSchema,
            startStatusReason: Schema.string,
            errorStatus: IdentifierStringSchema,
            errorStatusReason: Schema.string,
            finishStatus: IdentifierStringSchema,
            finishStatusReason: Schema.string,
        },
        eventbridge: {
            scheduler: {
                name: Schema.string,
                groupName: Schema.string,
                target: Schema.string,
                arn: Schema.string,
                expression: Schema.string,
                expressionTimeZone: Schema.string,
                maxFlexibleTimeWindowMinutes: Schema.integer,
                startDate: DateStringSchema,
                endDate: DateStringSchema,
            },
        },
    },
    email: {
        template: IdentifierStringSchema,
    },
    webSocket: {
        connectionId: Schema.id(),
        messageType: Schema.string,
    },
    notifications: {
        eventType: IdentifierStringSchema,
        eventId: Schema.id(),
    },
    tasks: {
        actions: Schema.string,
        actionCount: Schema.integer,
        actionTransactionId: Schema.id(),
        actionTransactionCount: Schema.integer,
        actionHistorySegmentCount: Schema.integer,
    },
    opensearch: {
        query: Schema.string,
        sort: Schema.string,
    },
    jobs: {
        type: IdentifierStringSchema,
        batchSize: Schema.integer,
        delaySeconds: Schema.float,
        queueDurationMs: Schema.float,
    },
    cohere: {
        textCount: Schema.integer,
        model: Schema.string,
        inputType: Schema.string,
        tokenCount: Schema.integer,
    },
    migration: {
        segmentIndex: Schema.integer,
        totalSegmentCount: Schema.integer,
    },
    apns: {
        connectionId: Schema.id(),
        errorReason: Schema.string,
    },
    cloudflare: {
        r2: {
            action: IdentifierStringSchema,
            bucket: Schema.string,
            object: {
                key: Schema.string,
                contentType: Schema.string,
            },
        },
    },
    github: {
        compareUrl: Schema.string,
        workflow: {
            run: {
                id: Schema.integer,
                number: Schema.integer,
                attempt: Schema.integer,
                url: Schema.string,
                commit: Schema.string,
            },
        },
    },
    deploy: {
        activeCommit: Schema.string,
        ongoingDeploymentCommit: Schema.string,
        dispatchedDeploymentCommit: Schema.string,
        newCommit: Schema.string,
        zonedTime: Schema.string,
        isTimeDeployable: Schema.boolean,
    },
    file: {
        contentType: Schema.string,
        contentLength: Schema.integer,
    },
};

/**
 * Schema for the flat event data. The map keys are the snake cased key paths.
 */
export const TracerEventFlatDataSchema: ReadonlyMap<
    string,
    SchemaWithOnlyDeserialization<TracerEventFlatData[string]>
> = (() => {
    const schema = new Map<string, SchemaWithOnlyDeserialization<TracerEventFlatData[string]>>();

    const add = (snakeCaseKeyPath: string, value: TracerEventDataSchemaBase[string]) => {
        if (!isPlainObject(value)) {
            schema.set(snakeCaseKeyPath, value);
        } else {
            for (const [camelCaseKey, keyValue] of Object.entries(value)) {
                const snakeCaseKey = convertCamelCaseToSnakeCase(camelCaseKey);
                add(`${snakeCaseKeyPath}.${snakeCaseKey}`, keyValue);
            }
        }
    };

    const nestedSchema: TracerEventDataSchemaBase = TracerEventDataSchema;
    for (const [camelCaseKey, keyValue] of Object.entries(nestedSchema)) {
        const snakeCaseKey = convertCamelCaseToSnakeCase(camelCaseKey);
        add(snakeCaseKey, keyValue);
    }

    return schema;
})();
