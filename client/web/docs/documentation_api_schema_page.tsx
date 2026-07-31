import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {DocumentationAnchorHeading} from "~/client/web/docs/internal/documentation_anchor_heading.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationApiDocBlock} from "~/client/web/docs/internal/documentation_api_doc_block.js";
import {DocumentationApiResponseSampleBlock} from "~/client/web/docs/internal/documentation_api_response_sample_block.js";
import {DocumentationApiTypeLabel} from "~/client/web/docs/internal/documentation_api_type_link.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {DocumentationMethodPill} from "~/client/web/docs/internal/documentation_method_pill.js";
import {DocumentationPill} from "~/client/web/docs/internal/documentation_pill.js";
import {buildDocumentationApiSchemaSample} from "~/shared/docs/build_api_documentation_schema_sample.js";
import {createDocumentationApiPageUrl} from "~/shared/docs/create_documentation_api_page_url.js";
import {
    DocumentationApiBacklink,
    DocumentationApiSchemaNode,
    createDocumentationApiOperationUrl,
    createDocumentationApiSchemaUrl,
    getDocumentationApiSchemaBaseName,
    getDocumentationApiSchemaNameVariant,
    getDocumentationApiSchemaRefName,
} from "~/shared/docs/documentation_api_model.js";
import {getDocumentationApiSchemaKindLabel} from "~/shared/docs/get_api_documentation_schema_kind_label.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * One schema page: the schema's doc block plus a precomputed "Referenced by"
 * section listing every schema, operation, and webhook that references it. Schema
 * pages are how readers walk the cyclic type graph one named type at a time.
 */
export function DocumentationApiSchemaPage({name}: {name: string}) {
    const model = useDocumentationApiModel();
    const schema = model.schemas[name];
    const nameVariant = getDocumentationApiSchemaNameVariant(name);
    const backlinks = model.backlinksBySchemaName[name] ?? [];
    const sample = schema !== undefined ? buildDocumentationApiSchemaSample(model, schema) : null;

    if (schema === undefined) {
        return (
            <Box fontSize="200" color="grey-50">
                Unknown schema: {name}
            </Box>
        );
    }

    const bodyHeading =
        schema.oneOf !== undefined
            ? "Variants"
            : schema.enum !== undefined
              ? "Values"
              : "Properties";
    const bodyHeadingId =
        schema.oneOf !== undefined
            ? "variants"
            : schema.enum !== undefined
              ? "values"
              : "properties";

    return (
        <Box>
            <Box
                fontSize="50"
                fontStyle="bold"
                color="grey-40"
                marginBottom="2.5"
                style={{textTransform: "uppercase", letterSpacing: "0.04em"}}
            >
                Schema
            </Box>
            <Box display="flex" alignItems="center" gap="2.5" flexWrap="wrap">
                <Box as="h1" margin="0">
                    <Box as="code" fontSize="600" fontStyle="code-bold" color="grey-90">
                        {getDocumentationApiSchemaBaseName(name)}
                    </Box>
                </Box>
                {nameVariant !== null ? (
                    <DocumentationPill color="theme-60" backgroundColor="theme-10">
                        {nameVariant} variant
                    </DocumentationPill>
                ) : null}
                <DocumentationPill color="grey-40" backgroundColor="grey-1" border="grey-5">
                    {getDocumentationApiSchemaKindLabel(schema)}
                </DocumentationPill>
            </Box>
            {schema.description !== undefined ? (
                <Box fontSize="200" color="grey-50" marginTop="3" style={{lineHeight: 1.6}}>
                    {schema.description}
                </Box>
            ) : null}

            <Box as="section" marginTop="8">
                <DocumentationAnchorHeading level={2} id={bodyHeadingId}>
                    {bodyHeading}
                </DocumentationAnchorHeading>
                {schema.oneOf !== undefined ? (
                    <DocumentationApiSchemaVariantLinks schema={schema} />
                ) : (
                    <DocumentationApiDocBlock node={{$ref: `#/components/schemas/${name}`}} />
                )}
            </Box>

            {sample !== null ? (
                <Box as="section" marginTop="10">
                    <DocumentationAnchorHeading level={2} id="example">
                        Example
                    </DocumentationAnchorHeading>
                    <DocumentationApiResponseSampleBlock sample={sample} />
                </Box>
            ) : null}

            {backlinks.length > 0 ? (
                <Box as="section" marginTop="10">
                    <DocumentationAnchorHeading level={2} id="referenced-by">
                        Referenced by
                    </DocumentationAnchorHeading>
                    <DocumentationApiSchemaBacklinks backlinks={backlinks} />
                </Box>
            ) : null}
        </Box>
    );
}

function DocumentationApiSchemaVariantLinks({schema}: {schema: DocumentationApiSchemaNode}) {
    const variants = (schema.oneOf ?? []).filter(variant => variant.type !== "null");

    return (
        <Box display="flex" flexWrap="wrap" gap="2">
            {variants.map((variant, index) => (
                <Box key={index}>
                    {variant.$ref !== undefined ? (
                        <DocumentationApiSchemaLinkChip
                            name={getDocumentationApiSchemaRefName(variant.$ref)}
                        />
                    ) : (
                        <Box
                            display="inline-flex"
                            alignItems="center"
                            paddingX="2.5"
                            paddingY="1"
                            borderRadius="1.5"
                            backgroundColor="grey-1"
                            border="grey-5"
                        >
                            <DocumentationApiTypeLabel node={variant} />
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
    );
}

function DocumentationApiSchemaBacklinks({
    backlinks,
}: {
    backlinks: Array<DocumentationApiBacklink>;
}) {
    const operationBacklinks = backlinks.filter(backlink => backlink.type === "operation");
    const schemaBacklinks = backlinks.filter(backlink => backlink.type === "schema");
    const webhookBacklinks = backlinks.filter(backlink => backlink.type === "webhook");

    return (
        <Box>
            {operationBacklinks.length > 0 ? (
                <DocumentationApiSchemaBacklinkSection title="Endpoints" id="endpoints">
                    {operationBacklinks.map((backlink, index) => (
                        <DocumentationApiSchemaBacklinkChip key={index} backlink={backlink} />
                    ))}
                </DocumentationApiSchemaBacklinkSection>
            ) : null}
            {schemaBacklinks.length > 0 ? (
                <DocumentationApiSchemaBacklinkSection title="Schemas" id="schemas">
                    {schemaBacklinks.map((backlink, index) => (
                        <DocumentationApiSchemaBacklinkChip key={index} backlink={backlink} />
                    ))}
                </DocumentationApiSchemaBacklinkSection>
            ) : null}
            {webhookBacklinks.length > 0 ? (
                <DocumentationApiSchemaBacklinkSection title="Webhooks" id="webhooks">
                    {webhookBacklinks.map((backlink, index) => (
                        <DocumentationApiSchemaBacklinkChip key={index} backlink={backlink} />
                    ))}
                </DocumentationApiSchemaBacklinkSection>
            ) : null}
        </Box>
    );
}

function DocumentationApiSchemaBacklinkSection({
    title,
    id,
    children,
}: {
    title: string;
    id: string;
    children: ReactNode;
}) {
    return (
        <Box>
            <DocumentationAnchorHeading level={3} id={`referenced-by-${id}`}>
                {title}
            </DocumentationAnchorHeading>
            <Box display="flex" flexWrap="wrap" gap="2">
                {children}
            </Box>
        </Box>
    );
}

function DocumentationApiSchemaBacklinkChip({backlink}: {backlink: DocumentationApiBacklink}) {
    switch (backlink.type) {
        case "schema":
            return <DocumentationApiSchemaLinkChip name={backlink.name} />;
        case "operation": {
            const link = (
                <DocumentationLink
                    url={createDocumentationApiOperationUrl(backlink.operation.slug)}
                    box={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "1.5",
                        paddingY: "1",
                        paddingLeft: "1.5",
                        paddingRight: "2.5",
                        borderRadius: "1.5",
                        backgroundColor: "grey-1",
                        border: "grey-5",
                    }}
                >
                    <DocumentationMethodPill method={backlink.operation.method} />
                    <Box as="span" fontSize="75" fontStyle="code" color="grey-50">
                        {backlink.operation.path}
                    </Box>
                </DocumentationLink>
            );
            return backlink.operation.description === null ? (
                link
            ) : (
                <Tooltip
                    content={backlink.operation.description}
                    placement="top"
                    isVisibleWhenFocusWithin={true}
                    isVisibleAfterPress={true}
                >
                    <span>{link}</span>
                </Tooltip>
            );
        }
        case "webhook":
            return (
                <DocumentationLink
                    url={createDocumentationApiPageUrl("webhooks")}
                    box={{
                        display: "inline-flex",
                        alignItems: "center",
                        paddingX: "2.5",
                        paddingY: "1",
                        borderRadius: "1.5",
                        backgroundColor: "grey-1",
                        border: "grey-5",
                        fontSize: "75",
                        fontStyle: "code",
                        color: "grey-50",
                    }}
                >
                    webhook: bot
                </DocumentationLink>
            );
        default:
            throw exhaustive(backlink);
    }
}

function DocumentationApiSchemaLinkChip({name}: {name: string}) {
    return (
        <DocumentationLink
            url={createDocumentationApiSchemaUrl(name)}
            box={{
                display: "inline-flex",
                alignItems: "center",
                paddingX: "2.5",
                paddingY: "1",
                borderRadius: "1.5",
                backgroundColor: "grey-1",
                border: "grey-5",
                fontSize: "75",
                fontStyle: "code",
                color: "grey-50",
            }}
        >
            {getDocumentationApiSchemaBaseName(name)}
        </DocumentationLink>
    );
}
