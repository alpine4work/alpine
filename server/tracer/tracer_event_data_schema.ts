import {
    tracerEventDataDynamoConsumedCapacityKeys,
    tracerEventDataDynamoPartitionTypesByTableName,
} from "~/server/tracer/tracer_event_data_dynamo.js";
import {allPlatforms} from "~/shared/design/core/platform.js";
import {allRouteLayouts} from "~/shared/design/core/route_layout.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {DateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {
    Schema,
    SchemaDeserializationError,
    SchemaWithOnlyDeserialization,
} from "~/shared/schema/schema.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.js";
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

const TracerEventExceptionDataBaseWithCauseSchema = {
    ...TracerEventExceptionDataBaseSchema,
    cause: {
        ...TracerEventExceptionDataBaseSchema,
        cause: TracerEventExceptionDataBaseSchema,
    },
};

/**
 * Schemas for all the properties in `TracerEventFullData`. This is in `server`
 * since we don't want it to eat into client bundle size. Likewise
 * `TracerEventFullData` is in a `types` directory so that none of its
 * dependencies are a part of client bundles.
 */
const TracerEventDataSchema = {
    name: Schema.string.singleLine().minLength(1),
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
                name: Schema.string,
                addr: Schema.string,
                port: Schema.string,
            },
            host: {
                name: Schema.string,
                addr: Schema.string,
                port: Schema.string,
            },
        },
    },
    http: {
        method: IdentifierStringSchema,
        statusCode: Schema.integer,
        flavor: Schema.string,
        userAgent: Schema.string,
        request: {
            header: Object.fromEntries(
                mapIterable(tracerEventHttpHeaderNames, headerName => [
                    headerName,
                    headerName === "content-length" ? Schema.integer : Schema.string,
                ]),
            ) as unknown as {[K in TracerEventHttpHeaderName]: Schema<string>},
            obfuscatedCookieHeader: Schema.string,
        },
        response: {
            header: Object.fromEntries(
                mapIterable(tracerEventHttpHeaderNames, headerName => [
                    headerName,
                    headerName === "content-length" ? Schema.integer : Schema.string,
                ]),
            ) as unknown as {[K in TracerEventHttpHeaderName]: Schema<string>},
            obfuscatedSetCookieHeader: Schema.string,
        },
        url: Schema.string,
        resendCount: Schema.integer,
        scheme: IdentifierStringSchema,
        target: Schema.string,
        route: Schema.string,
        search: Object.fromEntries(
            mapIterable(tracerEventHttpSearchParamNames, searchParamName => [
                searchParamName,
                Schema.string,
            ]),
        ) as unknown as {[K in TracerEventHttpSearchParamName]: Schema<string>},
        clientIp: Schema.string,
        service: {
            name: Schema.string,
        },
        fetchDurationMs: Schema.float,
    },
    exception: {
        ...TracerEventExceptionDataBaseWithCauseSchema,
        isOriginal: Schema.enum([true]),
        original: {
            time: DateStringSchema,
            traceId: Schema.id<TraceId>(),
            spanId: Schema.id<TraceSpanId>(),
        },
        aggregated1: TracerEventExceptionDataBaseWithCauseSchema,
        aggregated2: TracerEventExceptionDataBaseWithCauseSchema,
        aggregated3: TracerEventExceptionDataBaseWithCauseSchema,
        aggregated4: TracerEventExceptionDataBaseWithCauseSchema,
        aggregated5: TracerEventExceptionDataBaseWithCauseSchema,
    },
    common: {
        type: IdentifierStringSchema,
        branch: IdentifierStringSchema,
        count: Schema.integer,
        isBlocking: Schema.boolean,
        didNothing: Schema.boolean,
        processDurationMs: Schema.float,
        wasCached: Schema.boolean,
        width: Schema.float,
        height: Schema.float,
    },
    context: {
        handler: Schema.string,
        accountId: Schema.id(),
        spaceId: Schema.id(),
        botId: Schema.id(),
        isAnonymous: Schema.boolean,
        withoutSpaceAccess: Schema.boolean,
        webSocketConnectionId: Schema.id(),
        peekId: Schema.id(),
        taskId: Schema.id(),
        taskCollectionId: Schema.id(),
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
        route: Schema.string,
        platform: Schema.enum(allPlatforms),
        spacingScale: Schema.enum(allSpacingScales),
        routeLayout: Schema.enum(allRouteLayouts),
        renderingEngine: Schema.string,
    },
    dynamodb: {
        action: IdentifierStringSchema,
        tableName: Schema.string,
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
            type: Schema.string,
            cancellationReasons: Schema.string,
        },
    },
    aws: {
        credentials: {
            expirationTime: DateStringSchema,
        },
        ses: {
            messageId: Schema.string,
        },
        sqs: {
            queueName: IdentifierStringSchema,
            messageId: Schema.string,
            visibilityTimeout: Schema.float,
            waitTimeSeconds: Schema.float,
            maxNumberOfMessages: Schema.integer,
            messageCount: Schema.integer,
            approximateReceiveCount: Schema.integer,
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
        ec2: {
            securityGroupId: Schema.string,
            instanceCount: Schema.integer,
        },
    },
    email: {
        template: IdentifierStringSchema,
        source: Schema.string,
    },
    webSocket: {
        connectionId: Schema.id(),
        messageType: Schema.string,
    },
    content: {
        collaborative: {
            version: Schema.integer,
            startVersion: Schema.integer,
            endVersion: Schema.integer,
            stepCount: Schema.integer,
            clientVersion: Schema.integer,
            clientStepCount: Schema.integer,
        },
    },
    notifications: {
        eventType: IdentifierStringSchema,
        eventId: Schema.id(),
        emailDigest: {
            ineligibleReason: Schema.string,
            sendTime: DateStringSchema,
        },
    },
    tasks: {
        actions: Schema.string,
        actionCount: Schema.integer,
        actionTransactionId: Schema.id(),
        actionTransactionCount: Schema.integer,
        actionHistorySegmentCount: Schema.integer,
    },
    opensearch: {
        routing: Schema.string,
        query: Schema.string,
        sort: Schema.string,
        get: {
            found: Schema.boolean,
            id: Schema.string,
            seqNo: Schema.integer,
            primaryTerm: Schema.integer,
        },
        mget: {
            count: Schema.integer,
            foundCount: Schema.integer,
            routings: Schema.string,
            ids: Schema.string,
            seqNos: Schema.string,
            primaryTerms: Schema.string,
        },
        index: {
            id: Schema.string,
            ifSeqNo: Schema.integer,
            ifPrimaryTerm: Schema.integer,
            seqNo: Schema.integer,
            primaryTerm: Schema.integer,
        },
        bulk: {
            count: Schema.integer,
            routings: Schema.string,
            ids: Schema.string,
            actions: Schema.string,
            ifSeqNos: Schema.string,
            ifPrimaryTerms: Schema.string,
            seqNos: Schema.string,
            primaryTerms: Schema.string,
        },
        search: {
            hitCount: Schema.integer,
        },
    },
    jobs: {
        type: IdentifierStringSchema,
        queueName: IdentifierStringSchema,
        delaySeconds: Schema.float,
        queueDurationMs: Schema.float,
        willRetry: Schema.boolean,
        consumer: {
            startFiberCount: Schema.integer,
            endFiberCount: Schema.integer,
            maxFiberCount: Schema.integer,
        },
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
    webPush: {
        subscriptionEndpointOrigin: Schema.string,
        browserId: Schema.id(),
        responseStatusCode: Schema.integer,
    },
    cloudflare: {
        r2: {
            action: IdentifierStringSchema,
            bucket: Schema.string,
            object: {
                key: Schema.string,
                contentType: Schema.string,
                contentLength: Schema.integer,
            },
            multipartUpload: {
                id: Schema.string,
                partNumber: Schema.integer,
                partContentLength: Schema.integer,
                totalPartCount: Schema.integer,
            },
        },
        wrangler: {
            attempt: Schema.integer,
        },
        d1: {
            action: Schema.string,
            databaseName: Schema.string,
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
        jobType: Schema.string,
        jobReason: Schema.string,
        processorType: IdentifierStringSchema,
        createdTime: DateStringSchema,
        alternative: {
            contentType: Schema.string,
            contentLength: Schema.integer,
            contentLengthRatio: Schema.float,
        },
        preview: {
            contentType: Schema.string,
            contentLength: Schema.integer,
            contentLengthRatio: Schema.float,
            imageWidth: Schema.integer,
            imageHeight: Schema.integer,
            imageScale: Schema.float,
            imageHasAlpha: Schema.boolean,
            imageVideoDurationMs: Schema.float,
            audioDurationMs: Schema.float,
            codeContentLength: Schema.integer,
        },
        processing: {
            alternativeDurationMs: Schema.float,
            imagePreviewSizeDurationMs: Schema.float,
            imagePreviewPlaceholderDurationMs: Schema.float,
            imagePreviewContentDurationMs: Schema.float,
            imagePreviewVideoDurationDurationMs: Schema.float,
            audioPreviewDurationDurationMs: Schema.float,
            audioPreviewMetadataDurationMs: Schema.float,
            codePreviewContentDurationMs: Schema.float,
            imagePreviewVideoDurationToAlternativeProcessingDurationRatio: Schema.float,
        },
        avatar: {
            resize: {
                quality: Schema.integer,
                resizedContentLength: Schema.integer,
                resizedToOriginalContentLengthRatio: Schema.float,
                request: {
                    height: Schema.integer,
                    width: Schema.integer,
                    maxContentLength: Schema.integer,
                },
            },
        },
    },
    space: {
        members: {
            invite: {
                send: {
                    existingAccountId: Schema.id(),
                    newAccountId: Schema.id(),
                },
                invalidEmailAddressCount: Schema.integer,
                rejectedAsSpamEmailAddressCount: Schema.integer,
                alreadyMemberEmailAddressCount: Schema.integer,
                invitedEmailAddressCount: Schema.integer,
                unexpectedFailureEmailAddressCount: Schema.integer,
            },
        },
    },
    libreoffice: {
        outputFilter: Schema.string,
    },
    ffmpeg: {
        codecs: Schema.string,
    },
    sharp: {
        avif: {
            quality: Schema.integer,
            effort: Schema.integer,
        },
        inputContentLength: Schema.integer,
        outputContentLength: Schema.integer,
    },
    edge: {
        appServiceDurationMs: Schema.float,
    },
    openai: {
        model: Schema.string,
        responses: {
            id: Schema.string,
            promptCacheKey: Schema.string,
            safetyIdentifier: Schema.string,
            status: Schema.string,
            incompleteDetails: {
                reason: Schema.string,
            },
            usage: {
                inputTokens: Schema.integer,
                cachedInputTokens: Schema.integer,
                outputTokens: Schema.integer,
                reasoningOutputTokens: Schema.integer,
                totalTokens: Schema.integer,
            },
        },
    },
    agents: {
        schedule: {
            event: {
                time: DateStringSchema,
                executionTime: DateStringSchema,
                queueDurationMs: Schema.float,
                type: Schema.string,
            },
        },
    },
} satisfies TracerEventDataSchemaType<TracerEventFullData>;

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
