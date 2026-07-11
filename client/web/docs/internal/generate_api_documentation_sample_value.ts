import {
    DocumentationApiSchemaNode,
    getDocumentationApiSchemaRefName,
} from "~/client/web/docs/documentation_api_model.js";

/**
 * Realistic example ids in our 26-character lowercase base32 format, keyed by id
 * schema name so the same resource always renders the same id.
 */
export const documentationApiExampleIds: Record<string, string> = {
    AccountId: "0h2v9nker7wda4qcy1zsmt8x3b",
    SpaceId: "2k7pqz3m8rwvd1ac6yn0xhs4tb",
    DocumentId: "9mxr4td0kwq2vc7ap5ynhs38xb",
    TaskId: "5wq2n8hcy0rvd7ak3ztm1xps6b",
    ChatId: "8vc1rp0mkz9wda4qy3ntsx72hb",
    ChannelId: "3nr7wk9mzd0va2cq6yhs8xt1pb",
    PostId: "6dza9wk1mr0vc4qptynh8s3x2b",
    FileId: "1hs8wq3zmkr0vd9ac2ynt7px4b",
};

export const documentationApiExampleDefaultId = documentationApiExampleIds.AccountId!;

const documentationApiExampleDateTime = "2026-01-15T09:30:00Z";

const idPatternPrefix = /^\^\[0-9abcdefgh/;

export function getDocumentationApiExampleId(schemaName: string | null): string {
    return (
        (schemaName !== null ? documentationApiExampleIds[schemaName] : null) ??
        documentationApiExampleDefaultId
    );
}

/**
 * Generate a realistic JSON sample value for a schema node. Respects `required`
 * properties, discriminator `const` values (so union samples validate), id
 * formats, and ISO-8601 dates.
 *
 * The walk is guarded because the schema graph is cyclic. `depth` counts
 * structural JSON nesting (objects and arrays) and bounds the sample size, while
 * `hops` counts every recursion so even a pathological pure-`$ref` cycle
 * terminates.
 */
export function generateDocumentationApiSampleValue(
    schemas: Record<string, DocumentationApiSchemaNode>,
    node: DocumentationApiSchemaNode | null,
    {
        depth = 0,
        hops = 0,
        propertyName,
    }: {depth?: number; hops?: number; propertyName?: string} = {},
): unknown {
    if (node === null) return null;
    if (depth > 7 || hops > 40) return null;

    if (node.$ref !== undefined) {
        const refName = getDocumentationApiSchemaRefName(node.$ref);
        const referenced = schemas[refName];
        if (referenced === undefined) return null;

        if (referenced.pattern !== undefined && idPatternPrefix.test(referenced.pattern)) {
            return getDocumentationApiExampleId(refName);
        }
        if (referenced.format === "date-time") return documentationApiExampleDateTime;

        return generateDocumentationApiSampleValue(schemas, referenced, {
            depth,
            hops: hops + 1,
            propertyName,
        });
    }

    if (node.const !== undefined) return node.const;
    if (node.enum !== undefined && node.enum.length > 0) return node.enum[0];

    if (node.oneOf !== undefined) {
        const variants = node.oneOf.filter(variant => variant.type !== "null");
        if (variants.length === 0) return null;
        return generateDocumentationApiSampleValue(schemas, variants[0]!, {
            depth,
            hops: hops + 1,
            propertyName,
        });
    }

    if (node.allOf !== undefined) {
        const merged: Record<string, unknown> = {};
        for (const part of node.allOf) {
            const value = generateDocumentationApiSampleValue(schemas, part, {
                depth,
                hops: hops + 1,
                propertyName,
            });
            if (isPlainRecord(value)) Object.assign(merged, value);
        }
        return merged;
    }

    if (node.type === "object" || node.properties !== undefined) {
        const sample: Record<string, unknown> = {};
        const properties = node.properties ?? {};
        const requiredNames = node.required ?? Object.keys(properties);

        for (const [name, property] of Object.entries(properties)) {
            // Include every property near the top of the sample but only required properties
            // deeper down, keeping samples realistic without exploding.
            if (!requiredNames.includes(name) && depth >= 2) continue;

            const value = generateDocumentationApiSampleValue(schemas, property, {
                depth: depth + 1,
                hops: hops + 1,
                propertyName: name,
            });
            if (value !== undefined && value !== null) sample[name] = value;
        }

        if (node.additionalProperties === true && Object.keys(sample).length === 0) {
            sample.key = "value";
        }

        return sample;
    }

    if (node.type === "array" || node.items !== undefined) {
        const itemValue = generateDocumentationApiSampleValue(schemas, node.items ?? null, {
            depth: depth + 1,
            hops: hops + 1,
            propertyName,
        });
        return itemValue == null ? [] : [itemValue];
    }

    if (Array.isArray(node.type)) {
        const nonNullType = node.type.find(type => type !== "null");
        if (nonNullType === undefined) return null;
        return generatePrimitiveSampleValue(nonNullType, node, propertyName);
    }

    if (node.format === "date-time") return documentationApiExampleDateTime;

    return generatePrimitiveSampleValue(node.type, node, propertyName);
}

function generatePrimitiveSampleValue(
    type: string | undefined,
    node: DocumentationApiSchemaNode,
    propertyName: string | undefined,
): unknown {
    if (type === "boolean") return true;
    if (type === "integer" || type === "number") {
        if (node.minimum !== undefined) return node.minimum;
        if (typeof node.default === "number") return node.default;
        return 0;
    }
    if (type === "null") return null;

    if (node.format === "date-time") return documentationApiExampleDateTime;

    // String heuristics keyed off the property name so samples read naturally.
    const name = (propertyName ?? "").toLowerCase();
    if (name.includes("url"))
        return `https://api.alpine.inc/files/${documentationApiExampleIds.FileId}`;
    if (name === "title" || name === "name") return "Q3 Planning";
    if (name === "text") return "Everything in here is WIP.";
    if (name === "message") return "The request could not be completed.";
    if (name.includes("token")) return `sk_bot_${documentationApiExampleDefaultId.slice(0, 20)}`;
    if (name.includes("language")) return "typescript";
    if (name.includes("contenttype")) return "image/png";
    if (node.maxLength !== undefined && node.maxLength < 8) return "val";
    return "string";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
