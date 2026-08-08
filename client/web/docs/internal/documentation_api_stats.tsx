/* eslint-disable react-refresh/only-export-components -- co-located component factories bind API models for markdown generation. */
import {Box} from "~/client/web/design/box.js";
import {useDocumentationApiModel} from "~/client/web/docs/internal/documentation_api_context.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {DocumentationApiModel} from "~/shared/docs/documentation_api_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * The Introduction page's at-a-glance grid: base URL, wire format, and live counts
 * of endpoints and named types, all derived from the parsed spec.
 */
export const DocumentationApiStats = createDocumentationApiStatsComponent(null);

export function createDocumentationApiStatsComponent(model: DocumentationApiModel | null) {
    return documentationComponent({
        react: function DocumentationApiStatsView() {
            const stats = getDocumentationApiStats(useDocumentationApiModel());

            return (
                <Box
                    display="grid"
                    gap="3"
                    marginY="6"
                    style={{gridTemplateColumns: "repeat(2, minmax(0, 1fr))"}}
                >
                    {stats.map(stat => (
                        <DocumentationApiStatCard
                            key={stat.label}
                            label={stat.label}
                            value={stat.value}
                            mono={stat.mono}
                        />
                    ))}
                </Box>
            );
        },
        markdown: () =>
            `${getDocumentationApiStats(assertExists(model, "Expected documentation API model"))
                .map(stat => `- ${stat.label}: ${stat.mono ? `\`${stat.value}\`` : stat.value}`)
                .join("\n")}\n\n`,
    });
}

function getDocumentationApiStats(
    model: DocumentationApiModel,
): Array<{label: string; value: string; mono: boolean}> {
    return [
        {label: "Base URL", value: model.serverUrl, mono: true},
        {label: "Format", value: "JSON over HTTPS", mono: false},
        {
            label: "Endpoints",
            value: String(Object.keys(model.operationsBySlug).length),
            mono: false,
        },
        {label: "Named types", value: String(model.schemaNames.length), mono: false},
    ];
}

function DocumentationApiStatCard({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono: boolean;
}) {
    return (
        <Box
            display="flex"
            flexDirection="column"
            gap="1.5"
            padding="4"
            borderRadius="2"
            border="grey-5"
            backgroundColor="grey-0"
            boxShadow="elevation-5-without-border"
        >
            <Box
                fontSize="25"
                fontStyle="bold"
                color="grey-40"
                style={{textTransform: "uppercase", letterSpacing: "0.04em"}}
            >
                {label}
            </Box>
            <Box
                fontSize={mono ? "75" : "100"}
                fontStyle={mono ? "code" : "bold"}
                color="grey-90"
                style={{overflowWrap: "anywhere"}}
            >
                {value}
            </Box>
        </Box>
    );
}
