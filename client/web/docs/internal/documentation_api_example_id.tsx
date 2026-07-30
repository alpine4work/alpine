import {Box} from "~/client/web/design/box.js";
import {getDocumentationApiExampleId} from "~/client/web/docs/internal/generate_api_documentation_sample_value.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";

/**
 * An inline example identifier for API prose, e.g. `<ExampleId type="SpaceId" />`.
 * Uses the same deterministic sample ids the reference renders elsewhere, so ids
 * are consistent across the docs. With no `type` it renders the default id.
 */
export const DocumentationApiExampleId = documentationComponent({
    react: function DocumentationApiExampleIdView({type}: {type?: string}) {
        return (
            <Box
                as="code"
                fontSize="75"
                fontStyle="code"
                paddingX="1"
                borderRadius="1"
                backgroundColor="grey-1"
                border="grey-5"
                color="grey-90"
            >
                {getDocumentationApiExampleId(type ?? null)}
            </Box>
        );
    },
    markdown: props =>
        `\`${getDocumentationApiExampleId(typeof props.type === "string" ? props.type : null)}\``,
});
