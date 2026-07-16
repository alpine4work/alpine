import {Fragment, ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {DocumentationApiCodeSamples} from "~/client/web/docs/build_api_documentation_code_samples.js";
import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";
import {
    DocumentationApiOperation,
    DocumentationApiParameter,
    DocumentationApiSchemaNode,
} from "~/client/web/docs/documentation_api_model.js";
import {DocumentationAnchorHeading} from "~/client/web/docs/internal/documentation_anchor_heading.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationApiDocBlock} from "~/client/web/docs/internal/documentation_api_doc_block.js";
import {DocumentationApiResponseSampleBlock} from "~/client/web/docs/internal/documentation_api_response_sample_block.js";
import {DocumentationApiTypeLink} from "~/client/web/docs/internal/documentation_api_type_link.js";
import {DocumentationCodeBlock} from "~/client/web/docs/internal/documentation_code_block.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {DocumentationMethodPill} from "~/client/web/docs/internal/documentation_method_pill.js";
import {DocumentationPill} from "~/client/web/docs/internal/documentation_pill.js";
import {DocumentationSegmentedControl} from "~/client/web/docs/internal/documentation_segmented_control.js";
import {
    setDocumentationCodeSampleLanguage,
    useDocumentationCodeSampleLanguage,
} from "~/client/web/docs/internal/use_documentation_code_sample_language.js";

/**
 * One endpoint page: method pill + path header, a base URL / auth strip, then
 * everything in one content flow — doc block sections for parameters, request
 * body, and response, with the generated request example and the interactive
 * response example inline. Errors are never documented inline — every endpoint
 * shares one envelope, linked at the bottom.
 */
export function DocumentationApiEndpointPage({
    operation,
    samples,
}: {
    operation: DocumentationApiOperation;
    samples: DocumentationApiCodeSamples;
}) {
    const model = useDocumentationApiModel();

    return (
        <Box>
            <Box display="flex" alignItems="center" gap="3" flexWrap="wrap" marginBottom="2">
                <DocumentationMethodPill method={operation.method} />
                <Box as="code" fontSize="200" fontStyle="code" color="grey-90">
                    <DocumentationApiEndpointPathParts path={operation.path} />
                </Box>
            </Box>
            <Box as="h1" fontSize="700" fontStyle="extra-bold" color="grey-90" margin="0">
                {operation.title}
            </Box>
            {operation.description !== null ? (
                <Box fontSize="200" color="grey-50" marginTop="2.5" style={{lineHeight: 1.6}}>
                    {operation.description}
                </Box>
            ) : null}

            <Box
                display="flex"
                alignItems="center"
                gap="2.5"
                flexWrap="wrap"
                marginTop="4"
                padding="3"
                borderRadius="2"
                backgroundColor="grey-1"
                border="grey-5"
            >
                <Box as="span" fontSize="50" fontStyle="bold" color="grey-40">
                    BASE URL
                </Box>
                <Box as="code" fontSize="75" fontStyle="code" color="grey-50">
                    {model.serverUrl}
                </Box>
                <Box as="span" color="grey-10">
                    ·
                </Box>
                <Box as="span" fontSize="50" fontStyle="bold" color="grey-40">
                    AUTH
                </Box>
                <Box as="code" fontSize="75" fontStyle="code" color="grey-50">
                    Bearer token
                </Box>
            </Box>

            <DocumentationApiEndpointSection id="request" title="Request">
                {operation.pathParameters.length > 0 ? (
                    <DocumentationApiEndpointSection
                        id="path-parameters"
                        title="Path parameters"
                        level={3}
                    >
                        <DocumentationApiParameterRows parameters={operation.pathParameters} />
                    </DocumentationApiEndpointSection>
                ) : null}

                {operation.queryParameters.length > 0 ? (
                    <DocumentationApiEndpointSection
                        id="query-parameters"
                        title="Query parameters"
                        level={3}
                    >
                        <DocumentationApiParameterRows parameters={operation.queryParameters} />
                    </DocumentationApiEndpointSection>
                ) : null}

                {operation.requestBody?.schema != null ? (
                    <DocumentationApiEndpointSection
                        id="request-body"
                        title="Request body"
                        level={3}
                    >
                        <DocumentationApiDocBlock node={operation.requestBody.schema} />
                    </DocumentationApiEndpointSection>
                ) : null}

                <DocumentationApiEndpointSection
                    id="request-example"
                    title="Request example"
                    level={3}
                >
                    <DocumentationApiRequestExample samples={samples} />
                </DocumentationApiEndpointSection>
            </DocumentationApiEndpointSection>

            {operation.response?.schema != null || samples.response !== null ? (
                <DocumentationApiEndpointSection id="response" title="Response">
                    {operation.response?.schema != null ? (
                        <DocumentationApiEndpointSection
                            id="response-body"
                            title="Response body"
                            level={3}
                        >
                            <Box display="flex" alignItems="center" gap="2" marginBottom="1.5">
                                <DocumentationPill color="green-70" backgroundColor="green-10">
                                    {operation.response.status}
                                </DocumentationPill>
                                <Box as="span" fontSize="75" color="grey-50">
                                    application/json
                                </Box>
                            </Box>
                            <DocumentationApiDocBlock node={operation.response.schema} />
                        </DocumentationApiEndpointSection>
                    ) : null}

                    {samples.response !== null ? (
                        <DocumentationApiEndpointSection
                            id="response-example"
                            title="Response example"
                            level={3}
                        >
                            <DocumentationApiResponseSampleBlock
                                status={operation.response?.status ?? "200"}
                                sample={samples.response}
                            />
                        </DocumentationApiEndpointSection>
                    ) : null}
                </DocumentationApiEndpointSection>
            ) : null}

            <DocumentationApiEndpointSection id="errors" title="Errors">
                <Box fontSize="200" color="grey-50" style={{lineHeight: 1.6}}>
                    Every endpoint shares one error envelope. On failure you receive a non-2xx
                    status and a JSON body matching <DocumentationApiTypeLink name="Error" />. See
                    the{" "}
                    <DocumentationLink
                        url={createDocumentationApiPageUrl("errors")}
                        box={{color: "theme-50", fontStyle: "semi-bold"}}
                        style={{display: "inline"}}
                    >
                        Errors
                    </DocumentationLink>{" "}
                    page for the full reference and retry semantics.
                </Box>
            </DocumentationApiEndpointSection>
        </Box>
    );
}

function DocumentationApiEndpointSection({
    id,
    title,
    level = 2,
    children,
}: {
    id: string;
    title: string;
    level?: 2 | 3;
    children: ReactNode;
}) {
    return (
        <Box as="section" marginTop={level === 2 ? "10" : "6"}>
            <DocumentationAnchorHeading level={level} id={id}>
                {title}
            </DocumentationAnchorHeading>
            {children}
        </Box>
    );
}

// The two supported request example languages, designed so more slot in later.
const requestExampleLanguages = [
    {language: "curl", title: "cURL", codeLanguage: "bash", label: "cURL"},
    {language: "node", title: "Node", codeLanguage: "js", label: "node"},
] as const;

/**
 * The generated request example with the language switcher. The choice persists
 * globally so every endpoint page shows the same language.
 */
function DocumentationApiRequestExample({samples}: {samples: DocumentationApiCodeSamples}) {
    const language = useDocumentationCodeSampleLanguage();
    const selectedIndex = Math.max(
        0,
        requestExampleLanguages.findIndex(option => option.language === language),
    );
    const selectedOption = requestExampleLanguages[selectedIndex]!;

    return (
        <Box display="flex" flexDirection="column" gap="3" alignItems="flex-start">
            <DocumentationSegmentedControl
                ariaLabel="Request example language"
                options={requestExampleLanguages.map(option => option.title)}
                selectedIndex={selectedIndex}
                onSelect={index =>
                    setDocumentationCodeSampleLanguage(requestExampleLanguages[index]!.language)
                }
            />
            <Box width="full">
                <DocumentationCodeBlock
                    code={selectedOption.language === "curl" ? samples.curl : samples.node}
                    language={selectedOption.codeLanguage}
                    label={selectedOption.label}
                />
            </Box>
        </Box>
    );
}

function DocumentationApiParameterRows({
    parameters,
}: {
    parameters: Array<DocumentationApiParameter>;
}) {
    // Present the parameter list as one object schema so parameters and body
    // properties share the exact same doc row treatment.
    const properties: Record<string, DocumentationApiSchemaNode> = {};
    const required: Array<string> = [];
    for (const parameter of parameters) {
        properties[parameter.name] = {
            ...(parameter.schema ?? {}),
            ...(parameter.description !== null ? {description: parameter.description} : {}),
        };
        if (parameter.required) required.push(parameter.name);
    }

    return <DocumentationApiDocBlock node={{type: "object", properties, required}} />;
}

/**
 * The endpoint path with `{params}` rendered in the accent color.
 */
function DocumentationApiEndpointPathParts({path}: {path: string}) {
    const parts = path.split(/(\{[^}]+\})/g).filter(part => part.length > 0);
    return (
        <>
            {parts.map((part, index) =>
                /^\{.*\}$/.test(part) ? (
                    <Box as="span" key={index} color="theme-50">
                        {part}
                    </Box>
                ) : (
                    <Fragment key={index}>{part}</Fragment>
                ),
            )}
        </>
    );
}
