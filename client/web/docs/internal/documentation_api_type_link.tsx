/* eslint-disable react-refresh/only-export-components -- co-located markdown variants (plain functions) live beside these components. */
import {ReactNode, useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {
    DocumentationApiSchemaNode,
    createDocumentationApiSchemaUrl,
    getDocumentationApiSchemaBaseName,
    getDocumentationApiSchemaNameVariant,
    getDocumentationApiSchemaRefName,
} from "~/client/web/docs/documentation_api_model.js";
import {useDocumentationApiModelIfExists} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {DocumentationPill} from "~/client/web/docs/internal/documentation_pill.js";
import {getDocumentationApiSchemaKindLabel} from "~/client/web/docs/internal/get_api_documentation_schema_kind_label.js";
import {
    DocumentationMarkdownProps,
    flattenDocumentationMarkdownChildren,
} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";
import {toDocumentationMarkdownLinkUrl} from "~/client/web/docs/internal/to_documentation_markdown_link_url.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";

// Debounced open/close so the popover isn't twitchy when the pointer crosses a
// type link on its way somewhere else.
const popoverOpenDelayMs = 130;
const popoverCloseDelayMs = 160;

const popoverWidth = 340;

/**
 * A named schema type link — the signature interaction of the API reference.
 *
 * - Clicking navigates to the schema's page (`/docs/api/schemas/<Name>`), which is
 *   how readers walk cycles indefinitely.
 * - Hovering (or keyboard-focusing) opens a popover showing the type resolved one
 *   level deep. Type names inside the popover are themselves
 *   `DocumentationApiTypeLink`s so `Content → ContentBlockElement → …` can be
 *   explored without leaving the page.
 */
export function DocumentationApiTypeLink({name}: {name: string}) {
    const model = useDocumentationApiModelIfExists();
    const schema = model?.schemas[name];

    const [popover, setPopover] = useState<{left: number; top: number} | null>(null);
    const anchorRef = useRef<HTMLElement | null>(null);
    const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (openTimeoutRef.current !== null) clearTimeout(openTimeoutRef.current);
            if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
        };
    }, []);

    const nameVariant = getDocumentationApiSchemaNameVariant(name);

    if (schema === undefined) {
        // Guides render type links without loading the API model: still navigate to the
        // schema page, just without the hover popover. If we have a model and the name is
        // unknown, render plain text.
        if (model === null) {
            return (
                <DocumentationLink
                    url={createDocumentationApiSchemaUrl(name)}
                    box={{fontSize: "75", fontStyle: "code", color: "theme-50"}}
                    style={{
                        display: "inline",
                        borderBottom: `1px dashed ${colorSchemeVars["theme-50"]}`,
                    }}
                >
                    {getDocumentationApiSchemaBaseName(name)}
                </DocumentationLink>
            );
        }
        return (
            <Box as="span" fontSize="75" fontStyle="code" color="grey-90">
                {name}
            </Box>
        );
    }

    function openSoon() {
        if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
        if (popover !== null) return;
        if (openTimeoutRef.current !== null) clearTimeout(openTimeoutRef.current);
        openTimeoutRef.current = setTimeout(() => {
            const anchor = anchorRef.current;
            if (anchor === null) return;
            const rect = anchor.getBoundingClientRect();
            const rightGap = window.innerWidth - rect.right;
            const left = Math.max(
                12,
                rightGap < popoverWidth ? window.innerWidth - popoverWidth - 12 : rect.left,
            );
            setPopover({left, top: rect.bottom + 6});
        }, popoverOpenDelayMs);
    }

    function closeSoon() {
        if (openTimeoutRef.current !== null) clearTimeout(openTimeoutRef.current);
        if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = setTimeout(() => setPopover(null), popoverCloseDelayMs);
    }

    function cancelClose() {
        if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
    }

    return (
        <Box as="span" position="relative" style={{whiteSpace: "nowrap"}}>
            <span
                ref={anchorRef}
                onMouseEnter={openSoon}
                onMouseLeave={closeSoon}
                onFocus={openSoon}
                onBlur={closeSoon}
                onKeyDown={event => {
                    if (event.key === "Escape") setPopover(null);
                }}
                style={{display: "inline-flex"}}
            >
                <DocumentationLink
                    url={createDocumentationApiSchemaUrl(name)}
                    box={{fontSize: "75", fontStyle: "code", color: "theme-50"}}
                    style={{
                        borderBottom: `1px dashed ${colorSchemeVars["theme-50"]}`,
                        cursor: "pointer",
                    }}
                >
                    {getDocumentationApiSchemaBaseName(name)}
                </DocumentationLink>
            </span>
            {nameVariant !== null ? (
                <Box as="span" marginLeft="1" style={{verticalAlign: "middle"}}>
                    <DocumentationPill color="grey-40" backgroundColor="grey-1" border="grey-5">
                        {nameVariant}
                    </DocumentationPill>
                </Box>
            ) : null}
            {popover !== null ? (
                <DocumentationApiTypePopover
                    name={name}
                    schema={schema}
                    left={popover.left}
                    top={popover.top}
                    onMouseEnter={cancelClose}
                    onMouseLeave={closeSoon}
                />
            ) : null}
        </Box>
    );
}

/**
 * The hover popover for a type link: the schema's description plus a one-level
 * summary of its shape. Rendered on an elevated surface (soft shadow in light
 * mode, a lighter surface + border in dark mode).
 */
function DocumentationApiTypePopover({
    name,
    schema,
    left,
    top,
    onMouseEnter,
    onMouseLeave,
}: {
    name: string;
    schema: DocumentationApiSchemaNode;
    left: number;
    top: number;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}) {
    const scrollbarRef = useScrollbar<HTMLElement>();

    return (
        <div
            role="dialog"
            aria-label={`${name} type summary`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className={`${greyElevated2ClassName} ${sprinkles({
                position: "fixed",
                zIndex: "90",
                overflow: "hidden",
                backgroundColor: "grey-0",
                borderRadius: "2.5",
                boxShadow: "elevation-30",
                color: "grey-90",
            })}`}
            style={{
                left,
                top,
                width: popoverWidth,
                maxWidth: "92vw",
                whiteSpace: "normal",
            }}
        >
            {/* The scrollbar needs a `position: relative` scroll container,
                which the fixed popover itself can't be. */}
            <Box
                ref={scrollbarRef}
                position="relative"
                overflowY="auto"
                padding="3"
                style={{maxHeight: "52vh"}}
            >
                <Box display="flex" alignItems="center" gap="2" marginBottom="1.5">
                    <Box as="code" fontSize="75" fontStyle="code-semi-bold" color="grey-90">
                        {getDocumentationApiSchemaBaseName(name)}
                    </Box>
                    <Box as="span" fontSize="50" color="grey-40">
                        {getDocumentationApiSchemaKindLabel(schema)}
                    </Box>
                </Box>
                {schema.description !== undefined ? (
                    <Box fontSize="75" color="grey-50" marginBottom="2" style={{lineHeight: 1.45}}>
                        {schema.description}
                    </Box>
                ) : null}
                <DocumentationApiTypePopoverBody schema={schema} />
            </Box>
        </div>
    );
}

function DocumentationApiTypePopoverBody({schema}: {schema: DocumentationApiSchemaNode}) {
    if (schema.oneOf !== undefined) {
        const variants = schema.oneOf.filter(variant => variant.type !== "null");
        return (
            <Box>
                <Box fontSize="50" fontStyle="semi-bold" color="grey-40" marginBottom="1.5">
                    One of
                </Box>
                <Box display="flex" flexDirection="column" gap="1.5">
                    {variants.map((variant, index) => (
                        <Box key={index}>
                            {variant.$ref !== undefined ? (
                                <DocumentationApiTypeLink
                                    name={getDocumentationApiSchemaRefName(variant.$ref)}
                                />
                            ) : (
                                <DocumentationApiTypeLabel node={variant} />
                            )}
                        </Box>
                    ))}
                </Box>
            </Box>
        );
    }

    if (schema.enum !== undefined) {
        return (
            <Box display="flex" flexWrap="wrap" gap="1.5">
                {schema.enum.map((value, index) => (
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
        );
    }

    if (schema.type === "array" || schema.items !== undefined) {
        return (
            <Box fontSize="75">
                <Box as="span" color="grey-40">
                    Array of{" "}
                </Box>
                <DocumentationApiTypeLabel node={schema.items ?? {}} />
            </Box>
        );
    }

    if (schema.properties !== undefined) {
        const requiredNames = schema.required ?? [];
        const propertyNames = Object.keys(schema.properties);
        const visiblePropertyNames = propertyNames.slice(0, 9);
        return (
            <Box display="flex" flexDirection="column">
                {visiblePropertyNames.map((propertyName, index) => (
                    <Box
                        key={propertyName}
                        display="flex"
                        alignItems="baseline"
                        gap="2"
                        paddingY="1"
                        borderTop={index > 0 ? "grey-5" : "transparent"}
                    >
                        <Box as="code" fontSize="50" fontStyle="code" color="grey-90">
                            {propertyName}
                        </Box>
                        {requiredNames.includes(propertyName) ? (
                            <Box as="span" color="orange-70" style={{fontSize: 9}}>
                                ●
                            </Box>
                        ) : null}
                        <Box as="span" marginLeft="auto" style={{textAlign: "right"}}>
                            <DocumentationApiTypeLabel node={schema.properties![propertyName]!} />
                        </Box>
                    </Box>
                ))}
                {propertyNames.length > visiblePropertyNames.length ? (
                    <Box fontSize="50" color="grey-40" paddingTop="1.5">
                        +{propertyNames.length - visiblePropertyNames.length} more
                    </Box>
                ) : null}
            </Box>
        );
    }

    return <DocumentationApiTypeLabel node={schema} />;
}

/**
 * An inline label describing a schema node's type: named types become
 * `DocumentationApiTypeLink`s, unions join their parts with `|`, arrays get a `[]`
 * suffix, nullables get an `| null` suffix.
 */
export function DocumentationApiTypeLabel({node}: {node: DocumentationApiSchemaNode | null}) {
    if (node === null) {
        return (
            <Box as="span" fontSize="75" color="grey-40">
                any
            </Box>
        );
    }

    if (node.$ref !== undefined) {
        return <DocumentationApiTypeLink name={getDocumentationApiSchemaRefName(node.$ref)} />;
    }

    if (node.const !== undefined) {
        return (
            <Box as="code" fontSize="75" fontStyle="code" color="grey-50">
                {JSON.stringify(node.const)}
            </Box>
        );
    }

    if (node.oneOf !== undefined) {
        const variants = node.oneOf.filter(variant => variant.type !== "null");
        const hasNull = node.oneOf.some(variant => variant.type === "null");
        const parts: Array<ReactNode> = [];
        for (const [index, variant] of variants.entries()) {
            if (index > 0) {
                parts.push(
                    <Box as="span" key={`separator-${index}`} color="grey-40">
                        {" | "}
                    </Box>,
                );
            }
            parts.push(<DocumentationApiTypeLabel key={index} node={variant} />);
        }
        return (
            <Box as="span">
                {parts}
                {hasNull ? <DocumentationApiTypeNullSuffix /> : null}
            </Box>
        );
    }

    if (Array.isArray(node.type)) {
        const nonNullTypes = node.type.filter(type => type !== "null");
        return (
            <Box as="span">
                <Box as="span" fontSize="75" fontStyle="code" color="grey-50">
                    {nonNullTypes.join(" | ")}
                </Box>
                {node.type.includes("null") ? <DocumentationApiTypeNullSuffix /> : null}
            </Box>
        );
    }

    if (node.type === "array" || node.items !== undefined) {
        return (
            <Box as="span" display="inline-flex" alignItems="center">
                <DocumentationApiTypeLabel node={node.items ?? null} />
                <Box as="span" fontSize="75" fontStyle="code" color="grey-40">
                    []
                </Box>
            </Box>
        );
    }

    if (node.enum !== undefined) {
        return (
            <Box as="span" fontSize="75" fontStyle="code" color="grey-50">
                {typeof node.type === "string" ? node.type : "enum"}
            </Box>
        );
    }

    if (node.type === "object" || node.properties !== undefined) {
        return (
            <Box as="span" fontSize="75" fontStyle="code" color="grey-50">
                {node.additionalProperties === true && node.properties === undefined
                    ? "map"
                    : "object"}
            </Box>
        );
    }

    if (typeof node.type === "string") {
        return (
            <Box as="span" fontSize="75" fontStyle="code" color="grey-50">
                {node.type}
            </Box>
        );
    }

    return (
        <Box as="span" fontSize="75" color="grey-40">
            any
        </Box>
    );
}

function DocumentationApiTypeNullSuffix() {
    return (
        <Box as="span" fontSize="75" fontStyle="code" color="grey-40">
            {" | null"}
        </Box>
    );
}

/** Renders a `<TypeLink>` as a markdown link to the schema's page. */
export function documentationApiTypeLinkToMarkdown(props: DocumentationMarkdownProps): string {
    const name =
        typeof props.name === "string"
            ? props.name
            : flattenDocumentationMarkdownChildren(props.children);
    return `[${name}](${toDocumentationMarkdownLinkUrl(createDocumentationApiSchemaUrl(name))})`;
}
