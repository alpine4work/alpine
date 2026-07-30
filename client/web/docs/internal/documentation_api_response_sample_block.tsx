import {useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {
    DocumentationApiResponseSample,
    DocumentationApiResponseSampleHint,
} from "~/client/web/docs/internal/build_api_documentation_response_sample.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {DocumentationApiTypeLabel} from "~/client/web/docs/internal/documentation_api_type_link.js";
import {DocumentationCopyButton} from "~/client/web/docs/internal/documentation_copy_button.js";
import {DocumentationPill} from "~/client/web/docs/internal/documentation_pill.js";
import {highlightDocumentationCode} from "~/client/web/docs/internal/documentation_syntax_highlight.js";
import {getDocumentationApiConstraintMeta} from "~/client/web/docs/internal/get_api_documentation_constraint_meta.js";

/**
 * The generated response example as an interactive panel: the field hint pane sits
 * to the left of the code, and hovering (or keyboard-focusing) a property line
 * highlights it and fills the pane with that field's documentation — path, type,
 * required, and description. Type names in the hint are live
 * `DocumentationApiTypeLink`s, so the cyclic schema graph can be explored straight
 * from the example.
 *
 * The hint pane collapses above the code on narrow viewports (see
 * `.documentationCodeGuide` in the docs layout stylesheet).
 */
export function DocumentationApiResponseSampleBlock({
    status,
    label = "application/json",
    sample,
}: {
    status?: string;
    label?: string;
    sample: DocumentationApiResponseSample;
}) {
    const [activeHintId, setActiveHintId] = useState<string | null>(null);
    const activeHint = sample.hints.find(hint => hint.id === activeHintId) ?? null;

    const code = sample.lines.map(line => line.text).join("\n");

    return (
        <Box border="grey-5" borderRadius="2" overflow="hidden" backgroundColor="grey-0">
            <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                paddingY="1.5"
                paddingLeft="3"
                paddingRight="2"
                borderBottom="grey-5"
                backgroundColor="grey-1"
            >
                <Box display="flex" alignItems="center" gap="2">
                    {status !== undefined ? (
                        <DocumentationPill color="green-70" backgroundColor="green-10">
                            {status}
                        </DocumentationPill>
                    ) : null}
                    <Box as="span" fontSize="50" fontStyle="code" color="grey-40">
                        {label}
                    </Box>
                </Box>
                <DocumentationCopyButton text={code} />
            </Box>

            <Box className="documentationCodeGuide" display="grid" style={{minHeight: 220}}>
                <Box
                    padding="4"
                    borderRight="grey-5"
                    backgroundColor="grey-1"
                    display="flex"
                    flexDirection="column"
                    gap="1.5"
                >
                    {activeHint !== null ? (
                        <DocumentationApiResponseSampleHintBody hint={activeHint} />
                    ) : (
                        <Box fontSize="75" color="grey-40" marginY="auto">
                            Hover a highlighted line to inspect a field.
                        </Box>
                    )}
                </Box>

                <Box
                    as="pre"
                    // Code scrolls horizontally which our custom overlay scrollbar doesn't support;
                    // use the native scrollbar.
                    data-scrollbar="false"
                    margin="0"
                    padding="3"
                    overflowX="auto"
                    fontSize="75"
                    fontStyle="code"
                    color="grey-90"
                    style={{lineHeight: 1.65}}
                >
                    <code>
                        {sample.lines.map((line, index) => {
                            const interactive = line.hintId !== null;
                            const active = interactive && line.hintId === activeHintId;
                            return (
                                <Box
                                    as="span"
                                    key={index}
                                    display="block"
                                    borderRadius="1"
                                    backgroundColor={active ? "theme-10" : "transparent"}
                                    cursor={interactive ? "pointer" : undefined}
                                    tabIndex={interactive ? 0 : undefined}
                                    onMouseEnter={() => {
                                        if (line.hintId !== null) setActiveHintId(line.hintId);
                                    }}
                                    onFocus={() => {
                                        if (line.hintId !== null) setActiveHintId(line.hintId);
                                    }}
                                    style={{whiteSpace: "pre", minHeight: "1.65em"}}
                                >
                                    {highlightDocumentationCode(line.text, "json")}
                                    {"\n"}
                                </Box>
                            );
                        })}
                    </code>
                </Box>
            </Box>
        </Box>
    );
}

function DocumentationApiResponseSampleHintBody({
    hint,
}: {
    hint: DocumentationApiResponseSampleHint;
}) {
    const model = useDocumentationApiModel();
    const meta = getDocumentationApiConstraintMeta(model.schemas, hint.node);

    return (
        <>
            <Box fontSize="50" fontStyle="code" color="theme-50" style={{overflowWrap: "anywhere"}}>
                {hint.path}
            </Box>
            <Box display="flex" alignItems="center" gap="2" flexWrap="wrap">
                <Box as="code" fontSize="100" fontStyle="code-semi-bold" color="grey-90">
                    {hint.name}
                </Box>
                {hint.required ? (
                    <DocumentationPill color="orange-80" backgroundColor="orange-10">
                        required
                    </DocumentationPill>
                ) : (
                    <Box as="span" fontSize="50" color="grey-40">
                        optional
                    </Box>
                )}
            </Box>
            <Box>
                <DocumentationApiTypeLabel node={hint.node} />
            </Box>
            {meta.length > 0 ? (
                <Box display="flex" gap="1.5" flexWrap="wrap">
                    {meta.map((entry, index) => (
                        <Box
                            key={index}
                            as="span"
                            fontSize="50"
                            fontStyle="code"
                            color="grey-40"
                            backgroundColor="grey-0"
                            border="grey-5"
                            borderRadius="1"
                            paddingX="1.5"
                        >
                            {entry}
                        </Box>
                    ))}
                </Box>
            ) : null}
            {hint.description !== null ? (
                <Box fontSize="75" color="grey-50" style={{lineHeight: 1.5}}>
                    {hint.description}
                </Box>
            ) : null}
        </>
    );
}
