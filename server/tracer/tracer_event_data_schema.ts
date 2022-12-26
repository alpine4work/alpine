import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {IdentifierStringSchema} from "~/shared/schema/identifier_string_schema";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema, SchemaWithOnlyDeserialization} from "~/shared/schema/schema";
import {
    TracerEventFlatData,
    convertCamelCaseToSnakeCase,
} from "~/shared/tracer/helpers/build_tracer_event_flat_data";
import {
    TracerEventHttpHeaderName,
    tracerEventHttpHeaderNames,
} from "~/shared/tracer/helpers/tracer_event_http_header_names";
import {TracerEventDataBase, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

type TracerEventDataSchemaType<Data extends TracerEventDataBase> = {
    [Key in keyof Data]-?: NonNullable<Data[Key]> extends TracerEventDataBase
        ? TracerEventDataSchemaType<NonNullable<Data[Key]>>
        : Schema<NonNullable<Data[Key]>>;
};

type TracerEventDataSchemaBase = {
    readonly [key: string]:
        | SchemaWithOnlyDeserialization<string>
        | SchemaWithOnlyDeserialization<number>
        | SchemaWithOnlyDeserialization<boolean>
        | TracerEventDataSchemaBase;
};

/**
 * Schemas for all the properties in `TracerEventFullData`. This is in `server`
 * since we don't want it to eat into client bundle size. Likewise
 * `TracerEventFullData` is in a `types` directory so that none of its
 * dependencies are a part of client bundles.
 */
const TracerEventDataSchema: TracerEventDataSchemaType<TracerEventFullData> = {
    name: LabelStringSchema,
    durationMs: Schema.float,
    service: {
        name: IdentifierStringSchema,
    },
    meta: {
        annotationType: Schema.enum(["span_event", "link"]),
    },
    trace: {
        traceId: Schema.id,
        spanId: Schema.id,
        parentId: Schema.id,
        link: {
            spanId: Schema.id,
            traceId: Schema.id,
        },
    },
    js: {
        realmId: Schema.id,
        host: Schema.enum(["Web", "Node", "CloudflareWorker"]),
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
        escaped: Schema.boolean,
        message: Schema.string,
        stacktrace: Schema.string,
        type: IdentifierStringSchema,
    },
    context: {
        accountId: Schema.id,
        spaceId: Schema.id,
        documentId: Schema.id,
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
