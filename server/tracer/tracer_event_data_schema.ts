import {tracerEventDataDynamoConsumedCapacityKeys} from "~/server/tracer/internal/tracer_event_data_dynamo_consumed_capacity_keys.js";
import {DateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
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
        },
        url: LabelStringSchema,
        resendCount: Schema.integer,
        scheme: IdentifierStringSchema,
        target: LabelStringSchema,
        route: LabelStringSchema,
        clientIp: LabelStringSchema,
    },
    exception: {
        message: Schema.string,
        stacktrace: Schema.string,
        type: IdentifierStringSchema,
        displayMessage: Schema.string,
    },
    context: {
        accountId: Schema.id(),
        spaceId: Schema.id(),
        peekId: Schema.id(),
        documentId: Schema.id(),
        channelId: Schema.id(),
        postId: Schema.id(),
        chatId: Schema.id(),
        taskId: Schema.id(),
        taskCollectionId: Schema.id(),
        peek: {
            aboveDocumentId: Schema.id(),
            aboveChannelId: Schema.id(),
            abovePostId: Schema.id(),
            aboveChatId: Schema.id(),
        },
    },
    dynamodb: {
        action: IdentifierStringSchema,
        tableName: LabelStringSchema,
        consistentRead: Schema.boolean,
        consumedCapacity: {
            ...Object.fromEntries(
                tracerEventDataDynamoConsumedCapacityKeys.map(key => [
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
        conditionExpression: Schema.string,
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
            queue: IdentifierStringSchema,
            messageId: Schema.string,
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
        inbox: {
            spaceId: Schema.id(),
            accountId: Schema.id(),
        },
    },
    tasks: {
        actions: Schema.string,
        actionCount: Schema.integer,
        actionTransactionId: Schema.id(),
        actionTransactionCount: Schema.integer,
        actionHistorySegmentCount: Schema.integer,
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
