import {useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {
    DocumentationApiSchemaNode,
    getDocumentationApiSchemaBaseName,
    getDocumentationApiSchemaRefName,
    resolveDocumentationApiSchemaNode,
} from "~/client/web/docs/documentation_api_model.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationApiTypeLabel} from "~/client/web/docs/internal/documentation_api_type_link.js";
import {DocumentationChevron} from "~/client/web/docs/internal/documentation_chevron.js";
import {DocumentationPill} from "~/client/web/docs/internal/documentation_pill.js";
import {DocumentationSegmentedControl} from "~/client/web/docs/internal/documentation_segmented_control.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";
import {getDocumentationApiConstraintMeta} from "~/client/web/docs/internal/get_api_documentation_constraint_meta.js";
import {sprinkles} from "~/client/web/styles/styles.js";

/**
 * The core doc block renderer, reused for parameters, request bodies, responses,
 * the webhook payload, and schema pages. Renders one row per property; nested
 * objects expand lazily on click so the cyclic schema graph is only ever walked as
 * far as the reader asks.
 */
export function DocumentationApiDocBlock({
    node,
    depth = 0,
}: {
    node: DocumentationApiSchemaNode | null;
    depth?: number;
}) {
    const model = useDocumentationApiModel();

    if (node === null) {
        return (
            <Box fontSize="75" color="grey-40">
                —
            </Box>
        );
    }

    const {node: resolved} = resolveDocumentationApiSchemaNode(model.schemas, node);

    if (resolved.oneOf !== undefined)
        return <DocumentationApiUnionSelector node={resolved} depth={depth} />;

    if (resolved.type === "array" || resolved.items !== undefined) {
        const items = resolved.items ?? null;
        return (
            <Box>
                <Box display="flex" alignItems="center" gap="2" paddingBottom="2.5">
                    <Box as="span" fontSize="75" fontStyle="semi-bold" color="grey-40">
                        Array of
                    </Box>
                    <DocumentationApiTypeLabel node={items} />
                </Box>
                <DocumentationApiDocBlock node={items} depth={depth} />
            </Box>
        );
    }

    if (resolved.enum !== undefined) return <DocumentationApiEnumValues node={resolved} />;

    if (resolved.type === "object" || resolved.properties !== undefined) {
        const properties = resolved.properties ?? {};
        if (Object.keys(properties).length > 0) {
            return <DocumentationApiDocPropertyRows node={resolved} depth={depth} />;
        }
        return (
            <Box fontSize="100" color="grey-50" paddingY="1.5">
                {resolved.additionalProperties === true
                    ? "Free-form object — arbitrary string keys mapping to any JSON value."
                    : "Empty object."}
            </Box>
        );
    }

    return <DocumentationApiPrimitiveBody node={resolved} />;
}

function DocumentationApiDocPropertyRows({
    node,
    depth,
}: {
    node: DocumentationApiSchemaNode;
    depth: number;
}) {
    const requiredNames = node.required ?? [];
    const propertyNames = Object.keys(node.properties ?? {});

    return (
        <Box>
            {propertyNames.map((propertyName, index) => (
                <DocumentationApiDocRow
                    key={propertyName}
                    name={propertyName}
                    node={node.properties![propertyName]!}
                    required={requiredNames.includes(propertyName)}
                    first={index === 0}
                    depth={depth}
                />
            ))}
            {node.additionalProperties === true ? (
                <Box borderTop="grey-5" paddingY="2.5" fontSize="75" color="grey-40">
                    + additional properties allowed
                </Box>
            ) : null}
        </Box>
    );
}

/**
 * One property row: name in mono, its linked type, a required/optional marker,
 * constraint meta pills, the description, and (for nested objects and arrays of
 * objects) a chevron that lazily expands the nested doc block behind a hairline
 * left rail.
 */
function DocumentationApiDocRow({
    name,
    node,
    required,
    first,
    depth,
}: {
    name: string;
    node: DocumentationApiSchemaNode;
    required: boolean;
    first: boolean;
    depth: number;
}) {
    const model = useDocumentationApiModel();
    const [open, setOpen] = useState(false);

    const expandable = schemaNodeHasChildren(model.schemas, node, 0);
    const meta = getDocumentationApiConstraintMeta(model.schemas, node);

    return (
        <Box borderTop={first ? "transparent" : "grey-5"}>
            <Box display="flex" alignItems="flex-start" gap="2" paddingY="2.5" paddingX="0.5">
                <DocumentationUnstyledButton
                    ariaLabel={open ? `Collapse ${name}` : `Expand ${name}`}
                    ariaExpanded={expandable ? open : undefined}
                    onClick={() => {
                        if (expandable) setOpen(!open);
                    }}
                    box={{
                        border: "none",
                        backgroundColor: "transparent",
                        cursor: expandable ? "pointer" : "default",
                        opacity: expandable ? "100" : "0",
                        paddingTop: "0.5",
                    }}
                    style={{width: 16, flex: "0 0 auto"}}
                >
                    <DocumentationChevron open={open} />
                </DocumentationUnstyledButton>
                <Box flex="1" minWidth="flex-fit">
                    <Box display="flex" alignItems="center" gap="2" flexWrap="wrap">
                        <Box as="code" fontSize="75" fontStyle="code-semi-bold" color="grey-90">
                            {name}
                        </Box>
                        <DocumentationApiTypeLabel node={node} />
                        {required ? (
                            <DocumentationPill color="orange-80" backgroundColor="orange-10">
                                required
                            </DocumentationPill>
                        ) : (
                            <Box as="span" fontSize="50" color="grey-40">
                                optional
                            </Box>
                        )}
                    </Box>
                    {meta.length > 0 ? (
                        <Box display="flex" gap="1.5" flexWrap="wrap" marginTop="1.5">
                            {meta.map((entry, index) => (
                                <DocumentationApiConstraintMetaPill key={index}>
                                    {entry}
                                </DocumentationApiConstraintMetaPill>
                            ))}
                        </Box>
                    ) : null}
                    {node.description !== undefined ? (
                        <Box
                            fontSize="100"
                            color="grey-50"
                            marginTop="1.5"
                            style={{lineHeight: 1.5}}
                        >
                            {node.description}
                        </Box>
                    ) : null}
                    {open && expandable ? (
                        <Box marginTop="2" paddingLeft="3" borderLeft="grey-10">
                            <DocumentationApiDocBlock node={node} depth={depth + 1} />
                        </Box>
                    ) : null}
                </Box>
            </Box>
        </Box>
    );
}

/**
 * A `oneOf` union rendered with a variant selector: a segmented control when there
 * are at most four variants and a dropdown otherwise. Selecting a variant swaps
 * the nested doc block below.
 */
function DocumentationApiUnionSelector({
    node,
    depth,
}: {
    node: DocumentationApiSchemaNode;
    depth: number;
}) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const variants = (node.oneOf ?? []).filter(variant => variant.type !== "null");
    const discriminator = node.discriminator;

    const labels = variants.map((variant, index) => {
        const refName =
            variant.$ref !== undefined ? getDocumentationApiSchemaRefName(variant.$ref) : null;

        // Prefer the discriminator mapping key (the actual `type` value on the wire) as
        // the variant label.
        if (refName !== null && discriminator?.mapping !== undefined) {
            const mappingKey = Object.keys(discriminator.mapping).find(
                key => getDocumentationApiSchemaRefName(discriminator.mapping![key]!) === refName,
            );
            if (mappingKey !== undefined) return mappingKey;
        }

        if (refName !== null) return getDocumentationApiSchemaBaseName(refName);
        if (variant.const !== undefined) return String(variant.const);
        if (typeof variant.type === "string") return variant.type;
        return `Variant ${index + 1}`;
    });

    const selectedVariant = variants[selectedIndex] ?? variants[0] ?? null;

    return (
        <Box>
            <Box display="flex" alignItems="center" gap="2" marginBottom="3" flexWrap="wrap">
                <Box as="span" fontSize="50" fontStyle="semi-bold" color="grey-40">
                    {discriminator !== undefined
                        ? `one of · discriminated by ${discriminator.propertyName}`
                        : "one of"}
                </Box>
                {labels.length <= 4 ? (
                    <DocumentationSegmentedControl
                        ariaLabel="Union variant"
                        options={labels}
                        selectedIndex={selectedIndex}
                        onSelect={setSelectedIndex}
                    />
                ) : (
                    <select
                        value={selectedIndex}
                        onChange={event => setSelectedIndex(Number(event.currentTarget.value))}
                        aria-label="Union variant"
                        className={sprinkles({
                            fontSize: "75",
                            fontStyle: "code",
                            paddingX: "2.5",
                            paddingY: "1",
                            borderRadius: "1.5",
                            border: "grey-10",
                            backgroundColor: "grey-0",
                            color: "grey-90",
                            cursor: "pointer",
                        })}
                    >
                        {labels.map((label, index) => (
                            <option key={index} value={index}>
                                {label}
                            </option>
                        ))}
                    </select>
                )}
            </Box>
            <Box key={selectedIndex}>
                <DocumentationApiDocBlock node={selectedVariant} depth={depth} />
            </Box>
        </Box>
    );
}

function DocumentationApiEnumValues({node}: {node: DocumentationApiSchemaNode}) {
    const values = node.enum ?? [];
    return (
        <Box paddingY="1.5">
            <Box fontSize="75" color="grey-50" marginBottom="2">
                One of the following {values.length} values:
            </Box>
            <Box display="flex" flexWrap="wrap" gap="1.5">
                {values.map((value, index) => (
                    <Box
                        key={index}
                        as="code"
                        fontSize="50"
                        fontStyle="code"
                        backgroundColor="grey-1"
                        border="grey-5"
                        borderRadius="1.5"
                        paddingX="2"
                        paddingY="0.5"
                        color="grey-90"
                    >
                        {JSON.stringify(value)}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

function DocumentationApiPrimitiveBody({node}: {node: DocumentationApiSchemaNode}) {
    const model = useDocumentationApiModel();
    const meta = getDocumentationApiConstraintMeta(model.schemas, node);

    return (
        <Box paddingY="1.5">
            <Box display="flex" alignItems="center" gap="2" flexWrap="wrap">
                <DocumentationApiTypeLabel node={node} />
                {meta.map((entry, index) => (
                    <DocumentationApiConstraintMetaPill key={index}>
                        {entry}
                    </DocumentationApiConstraintMetaPill>
                ))}
            </Box>
            {node.description !== undefined ? (
                <Box fontSize="100" color="grey-50" marginTop="2">
                    {node.description}
                </Box>
            ) : null}
        </Box>
    );
}

function DocumentationApiConstraintMetaPill({children}: {children: string}) {
    return (
        <Box
            as="span"
            fontSize="50"
            fontStyle="code"
            color="grey-40"
            backgroundColor="grey-1"
            border="grey-5"
            borderRadius="1"
            paddingX="1.5"
        >
            {children}
        </Box>
    );
}

/**
 * Whether a doc row can expand into a nested doc block. Resolves `$ref`s and array
 * items with a small depth guard so a self-referential array can't spin this check
 * forever.
 */
function schemaNodeHasChildren(
    schemas: Record<string, DocumentationApiSchemaNode>,
    node: DocumentationApiSchemaNode,
    depth: number,
): boolean {
    if (depth > 4) return false;

    const {node: resolved} = resolveDocumentationApiSchemaNode(schemas, node);

    if (resolved.oneOf !== undefined) return true;
    if (resolved.type === "array" || resolved.items !== undefined) {
        if (resolved.items === undefined) return false;
        return schemaNodeHasChildren(schemas, resolved.items, depth + 1);
    }
    if (resolved.properties !== undefined && Object.keys(resolved.properties).length > 0) {
        return true;
    }
    return false;
}
