import {parse} from "yaml";
import {
    DocumentationApiBacklink,
    DocumentationApiGroup,
    DocumentationApiMethod,
    DocumentationApiModel,
    DocumentationApiOperation,
    DocumentationApiOperationReference,
    DocumentationApiParameter,
    DocumentationApiSchemaNode,
    createDocumentationApiOperationSlug,
    getDocumentationApiSchemaRefName,
} from "~/client/web/docs/documentation_api_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

const documentationApiMethods = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Parse the OpenAPI specification YAML into an `DocumentationApiModel`.
 *
 * The specification has no `tags`, so operations are grouped by the first path
 * segment (`/documents/...` → "Documents") and given readable titles derived from
 * the method + path (`GET /chats/{id}/messages` → "List messages"). While parsing
 * we also precompute, for every named schema, the set of schemas, operations, and
 * webhooks that reference it ("Referenced by").
 */
export function parseDocumentationApiModel(specificationYaml: string): DocumentationApiModel {
    const document: unknown = parse(specificationYaml);
    assert(isPlainObject(document), "Expected the OpenAPI document to be an object");

    const info = isPlainObject(document.info) ? document.info : {};
    const components = isPlainObject(document.components) ? document.components : {};
    const componentSchemas = isPlainObject(components.schemas) ? components.schemas : {};
    const componentResponses = isPlainObject(components.responses) ? components.responses : {};
    const componentRequestBodies = isPlainObject(components.requestBodies)
        ? components.requestBodies
        : {};

    const schemas: Record<string, DocumentationApiSchemaNode> = {};
    for (const [name, rawSchema] of Object.entries(componentSchemas)) {
        const schema = parseSchemaNode(rawSchema);
        if (schema !== null) schemas[name] = schema;
    }

    const resolveJsonContentSchema = createJsonContentSchemaResolver({
        componentResponses,
        componentRequestBodies,
    });

    // Parse every operation from `paths`, skipping the specification download endpoint
    // which would be noise in the reference.
    const operations: Array<DocumentationApiOperation> = [];
    const paths = isPlainObject(document.paths) ? document.paths : {};
    for (const [path, rawPathItem] of Object.entries(paths)) {
        if (path === "/specification.yaml") continue;
        if (!isPlainObject(rawPathItem)) continue;

        const commonParameters = Array.isArray(rawPathItem.parameters)
            ? rawPathItem.parameters
            : [];

        for (const method of documentationApiMethods) {
            const rawOperation = rawPathItem[method];
            if (!isPlainObject(rawOperation)) continue;

            const operationParameters = Array.isArray(rawOperation.parameters)
                ? rawOperation.parameters
                : [];
            const parameters = [...commonParameters, ...operationParameters].map(parseParameter);

            const upperCaseMethod = method.toUpperCase();
            assert(isDocumentationApiMethod(upperCaseMethod));

            const requestBody = parseRequestBody(rawOperation.requestBody);
            const response = parseResponse(rawOperation.responses);

            const slug = createDocumentationApiOperationSlug(upperCaseMethod, path);
            operations.push({
                slug,
                method: upperCaseMethod,
                path,
                group: getGroupName(path),
                title: deriveOperationTitle(method, path),
                description:
                    typeof rawOperation.description === "string"
                        ? rawOperation.description
                        : typeof rawOperation.summary === "string"
                          ? rawOperation.summary
                          : null,
                pathParameters: parameters.filter(parameter => parameter.location === "path"),
                queryParameters: parameters.filter(parameter => parameter.location === "query"),
                requestBody,
                response,
            });
        }
    }

    // Group operations by their first path segment. Groups are sorted alphabetically
    // while operations keep their specification order.
    const groupsByName = new Map<string, DocumentationApiGroup>();
    for (const operation of operations) {
        let group = groupsByName.get(operation.group);
        if (group === undefined) {
            group = {
                name: operation.group,
                title: getGroupTitle(operation.group),
                operations: [],
            };
            groupsByName.set(operation.group, group);
        }
        group.operations.push(createOperationReference(operation));
    }
    const groups = Array.from(groupsByName.values()).sort((group1, group2) =>
        group1.name.localeCompare(group2.name),
    );

    const operationsBySlug: Record<string, DocumentationApiOperation> = {};
    for (const operation of operations) operationsBySlug[operation.slug] = operation;

    // The `webhooks.bot` payload is documented on its own page with the same doc block
    // treatment as endpoint request bodies.
    const webhooks = isPlainObject(document.webhooks) ? document.webhooks : {};
    const botWebhook = isPlainObject(webhooks.bot) ? webhooks.bot : {};
    const botWebhookPost = isPlainObject(botWebhook.post) ? botWebhook.post : {};
    const webhookPayloadSchema = resolveJsonContentSchema(botWebhookPost.requestBody);

    // The error envelope lives in `components/responses/Error` (every operation's
    // `default` response). The Errors page documents it with the same doc block.
    const errorSchema = resolveJsonContentSchema({$ref: "#/components/responses/Error"});

    const backlinksBySchemaName = computeBacklinks({
        componentSchemas,
        operations,
        webhookPayloadSchema,
    });

    const servers = Array.isArray(document.servers) ? document.servers : [];
    const firstServer = isPlainObject(servers[0]) ? servers[0] : {};

    return {
        title: typeof info.title === "string" ? info.title : "API",
        description: typeof info.description === "string" ? info.description : "",
        version: typeof info.version === "string" ? info.version : "",
        serverUrl: typeof firstServer.url === "string" ? firstServer.url : "",
        groups,
        operationsBySlug,
        schemas,
        schemaNames: Object.keys(schemas).sort((name1, name2) => name1.localeCompare(name2)),
        backlinksBySchemaName,
        webhookPayloadSchema,
        errorSchema,
    };

    /**
     * Resolve an operation request body into the subset the docs render.
     */
    function parseRequestBody(rawRequestBody: unknown) {
        const resolvedRequestBody = resolveComponentRef(rawRequestBody, componentRequestBodies);
        if (resolvedRequestBody === null) return null;

        return {
            required: resolvedRequestBody.required === true,
            description:
                typeof resolvedRequestBody.description === "string"
                    ? resolvedRequestBody.description
                    : null,
            schema: resolveJsonContentSchema(rawRequestBody),
        };
    }

    /**
     * Resolve the first successful response shape we document for an operation.
     */
    function parseResponse(rawResponses: unknown) {
        if (!isPlainObject(rawResponses)) return null;

        for (const status of ["200", "201", "302"]) {
            const rawResponse = rawResponses[status];
            if (rawResponse === undefined) continue;
            return {status, schema: resolveJsonContentSchema(rawResponse)};
        }

        return null;
    }
}

/**
 * Check whether a parsed OpenAPI method is one the docs reference supports.
 */
function isDocumentationApiMethod(method: string): method is DocumentationApiMethod {
    return (
        method === "GET" ||
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE"
    );
}

/**
 * Create the compact operation reference stored in navigation and backlinks.
 */
function createOperationReference(
    operation: DocumentationApiOperation,
): DocumentationApiOperationReference {
    return {
        slug: operation.slug,
        method: operation.method,
        path: operation.path,
        title: operation.title,
        description: operation.description,
    };
}

/**
 * Structurally copy the JSON Schema fields we render from a raw parsed YAML node.
 * Anything unrecognized is dropped which also keeps the serialized model lean.
 */
function parseSchemaNode(value: unknown): DocumentationApiSchemaNode | null {
    if (!isPlainObject(value)) return null;

    const node: DocumentationApiSchemaNode = {};

    // Copy the schema fields in the same rough order OpenAPI emits them so JSON
    // fixtures and generated output stay readable in diffs.
    if (typeof value.$ref === "string") node.$ref = value.$ref;

    if (typeof value.type === "string") {
        node.type = value.type;
    } else if (Array.isArray(value.type)) {
        node.type = value.type.filter(entry => typeof entry === "string");
    }

    if (typeof value.description === "string") node.description = value.description;

    if (isPlainObject(value.properties)) {
        const properties: Record<string, DocumentationApiSchemaNode> = {};
        for (const [name, rawProperty] of Object.entries(value.properties)) {
            const property = parseSchemaNode(rawProperty);
            if (property !== null) properties[name] = property;
        }
        node.properties = properties;
    }

    if (Array.isArray(value.required)) {
        node.required = value.required.filter(entry => typeof entry === "string");
    }

    if (typeof value.additionalProperties === "boolean") {
        node.additionalProperties = value.additionalProperties;
    } else if (value.additionalProperties !== undefined) {
        const additionalProperties = parseSchemaNode(value.additionalProperties);
        if (additionalProperties !== null) node.additionalProperties = additionalProperties;
    }

    if (value.items !== undefined) {
        const items = parseSchemaNode(value.items);
        if (items !== null) node.items = items;
    }

    if (Array.isArray(value.oneOf)) {
        node.oneOf = value.oneOf.flatMap(entry => {
            const variant = parseSchemaNode(entry);
            return variant === null ? [] : [variant];
        });
    }

    if (Array.isArray(value.allOf)) {
        node.allOf = value.allOf.flatMap(entry => {
            const part = parseSchemaNode(entry);
            return part === null ? [] : [part];
        });
    }

    if (
        isPlainObject(value.discriminator) &&
        typeof value.discriminator.propertyName === "string"
    ) {
        const mapping: Record<string, string> = {};
        if (isPlainObject(value.discriminator.mapping)) {
            for (const [key, ref] of Object.entries(value.discriminator.mapping)) {
                if (typeof ref === "string") mapping[key] = ref;
            }
        }
        node.discriminator = {propertyName: value.discriminator.propertyName, mapping};
    }

    if (Array.isArray(value.enum)) {
        node.enum = value.enum.filter(isJsonPrimitive);
    }

    if (isJsonPrimitive(value.const)) node.const = value.const;

    if (typeof value.format === "string") node.format = value.format;
    if (typeof value.pattern === "string") node.pattern = value.pattern;
    if (typeof value.minLength === "number") node.minLength = value.minLength;
    if (typeof value.maxLength === "number") node.maxLength = value.maxLength;
    if (typeof value.minimum === "number") node.minimum = value.minimum;
    if (typeof value.maximum === "number") node.maximum = value.maximum;
    if (typeof value.minItems === "number") node.minItems = value.minItems;
    if (typeof value.maxItems === "number") node.maxItems = value.maxItems;
    if (value.default !== undefined) node.default = value.default;

    return node;
}

/**
 * Check whether a value can be represented inside JSON Schema `enum` or `const`.
 */
function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}

/**
 * Parse a raw OpenAPI parameter into the parameter model rendered by docs.
 */
function parseParameter(rawParameter: unknown): DocumentationApiParameter & {location: string} {
    if (!isPlainObject(rawParameter)) {
        return {name: "", required: false, description: null, schema: null, location: ""};
    }

    return {
        name: typeof rawParameter.name === "string" ? rawParameter.name : "",
        required: rawParameter.required === true,
        description: typeof rawParameter.description === "string" ? rawParameter.description : null,
        schema: parseSchemaNode(rawParameter.schema),
        location: typeof rawParameter.in === "string" ? rawParameter.in : "",
    };
}

/**
 * Create a resolver that follows a response/request body container through
 * `components/responses` or `components/requestBodies` to its `application/json`
 * schema.
 */
function createJsonContentSchemaResolver({
    componentResponses,
    componentRequestBodies,
}: {
    componentResponses: {[key: string]: unknown};
    componentRequestBodies: {[key: string]: unknown};
}) {
    return function resolveJsonContentSchema(
        container: unknown,
    ): DocumentationApiSchemaNode | null {
        const resolvedContainer =
            resolveComponentRef(container, componentResponses) ??
            resolveComponentRef(container, componentRequestBodies);
        if (resolvedContainer === null) return null;

        const content = isPlainObject(resolvedContainer.content) ? resolvedContainer.content : {};
        const jsonContent = isPlainObject(content["application/json"])
            ? content["application/json"]
            : {};
        return parseSchemaNode(jsonContent.schema);
    };
}

/**
 * If the container is a `$ref` into a components collection, return the referenced
 * definition. Otherwise return the container itself.
 */
function resolveComponentRef(
    container: unknown,
    componentCollection: {[key: string]: unknown},
): {[key: string]: unknown} | null {
    if (!isPlainObject(container)) return null;
    if (typeof container.$ref !== "string") return container;

    const referenced = componentCollection[getDocumentationApiSchemaRefName(container.$ref)];
    return isPlainObject(referenced) ? referenced : null;
}

/**
 * Pick the operation group name from the first path segment.
 */
function getGroupName(path: string): string {
    return path.split("/").find(segment => segment.length > 0) ?? "";
}

/**
 * Convert an API group slug into a display title.
 */
function getGroupTitle(groupName: string): string {
    return groupName
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

/**
 * Derive a readable operation title from the method + path (e.g.
 * `GET /chats/{id}/messages` → "List messages", `POST /documents` → "Create
 * document"). Mirrors the heuristics from the docs prototype.
 */
function deriveOperationTitle(method: string, path: string): string {
    const segments = path.split("/").filter(segment => segment.length > 0);
    const lastSegment = segments[segments.length - 1] ?? "";
    const isParameterSegment = (segment: string) => /^\{.*\}$/.test(segment);

    if (path.includes("/stream/")) {
        const streamIndex = segments.indexOf("stream");
        const tail = segments
            .slice(streamIndex + 1)
            .filter(segment => !isParameterSegment(segment))
            .join(" ");
        return `${method === "post" ? "Append" : "Update"} ${tail}`;
    }

    if (lastSegment === "mention") return "Get mention";
    if (lastSegment === "inbox") return "Get inbox";
    if (lastSegment === "settings") return `${method === "patch" ? "Update" : "Get"} bot settings`;
    if (lastSegment === "content") return "Download file content";

    const subjectSegment = isParameterSegment(lastSegment)
        ? (segments.filter(segment => !isParameterSegment(segment)).pop() ?? "")
        : lastSegment;
    const subject = subjectSegment.replace(/-/g, " ");

    switch (method) {
        case "get":
            return isParameterSegment(lastSegment)
                ? `Get ${singularize(subject)}`
                : `List ${subject}`;
        case "post":
            if (lastSegment === "messages" || lastSegment === "notes") {
                return `Send ${singularize(subject)}`;
            }
            return `Create ${singularize(subject)}`;
        case "patch":
        case "put":
            return `Update ${singularize(subject)}`;
        case "delete":
            return `Delete ${singularize(subject)}`;
        default:
            return `${method.toUpperCase()} ${subject}`;
    }
}

/**
 * Apply a small English singularization heuristic for generated operation names.
 */
function singularize(word: string): string {
    if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.endsWith("sses")) return word.slice(0, -2);
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
}

/**
 * Deep-scan for `$ref`s to precompute, for each named schema, everything that
 * references it. Operations are scanned in their parsed form so references through
 * shared `components/responses` and `components/requestBodies` count as endpoint
 * usage.
 */
function computeBacklinks({
    componentSchemas,
    operations,
    webhookPayloadSchema,
}: {
    componentSchemas: {[key: string]: unknown};
    operations: Array<DocumentationApiOperation>;
    webhookPayloadSchema: DocumentationApiSchemaNode | null;
}): Record<string, Array<DocumentationApiBacklink>> {
    const backlinksBySchemaName: Record<string, Array<DocumentationApiBacklink>> = {};
    const seenBacklinkKeysBySchemaName = new Map<string, Set<string>>();

    /**
     * Add a backlink once for each schema/source pair.
     */
    function addBacklink(schemaName: string, key: string, backlink: DocumentationApiBacklink) {
        let seenKeys = seenBacklinkKeysBySchemaName.get(schemaName);
        if (seenKeys === undefined) {
            seenKeys = new Set();
            seenBacklinkKeysBySchemaName.set(schemaName, seenKeys);
        }
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        (backlinksBySchemaName[schemaName] ??= []).push(backlink);
    }

    /**
     * Recursively walk arbitrary OpenAPI-shaped data and report schema refs.
     */
    function scanForRefs(value: unknown, addRefName: (name: string) => void) {
        if (Array.isArray(value)) {
            for (const entry of value) scanForRefs(entry, addRefName);
            return;
        }

        if (!isPlainObject(value)) return;

        if (typeof value.$ref === "string" && value.$ref.includes("/schemas/")) {
            addRefName(getDocumentationApiSchemaRefName(value.$ref));
        }

        // Avoid recursing back into `$ref` as a string after already recording it; all
        // other fields may contain nested schema nodes or arrays of nodes.
        for (const [key, entry] of Object.entries(value)) {
            if (key !== "$ref") scanForRefs(entry, addRefName);
        }
    }

    // Schema-to-schema references drive the schema "Referenced by" section.
    for (const [fromName, rawSchema] of Object.entries(componentSchemas)) {
        scanForRefs(rawSchema, schemaName => {
            addBacklink(schemaName, `schema:${fromName}`, {type: "schema", name: fromName});
        });
    }

    // Endpoint references are scanned after operation parsing so shared responses and
    // request bodies have already been resolved into the operation model.
    for (const operation of operations) {
        const operationNodes = [
            operation.pathParameters,
            operation.queryParameters,
            operation.requestBody,
            operation.response,
        ];
        scanForRefs(operationNodes, schemaName => {
            addBacklink(schemaName, `operation:${operation.slug}`, {
                type: "operation",
                operation: createOperationReference(operation),
            });
        });
    }

    // Webhook payloads are not operations, but schema pages should still show that
    // they are referenced by the bot webhook contract.
    scanForRefs(webhookPayloadSchema, schemaName => {
        addBacklink(schemaName, "webhook", {type: "webhook"});
    });

    return backlinksBySchemaName;
}
