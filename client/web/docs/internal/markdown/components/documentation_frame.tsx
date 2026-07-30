import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";

/**
 * A product screenshot frame: a hairline, soft-shadow card with a caption. Until
 * real screenshot assets exist it renders a striped placeholder. In markdown it
 * becomes a short blockquote noting the label and caption, since there is no image
 * to embed.
 */
export const DocumentationFrame = documentationComponent({
    react: ({caption, label}: {caption?: string; label?: string}) => (
        <Box as="figure" marginY="5" marginX="0">
            <Box
                border="grey-5"
                borderRadius="2.5"
                overflow="hidden"
                boxShadow="elevation-5-without-border"
            >
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    style={{
                        height: 260,
                        background: `repeating-linear-gradient(135deg, ${colorSchemeVars["grey-1"]}, ${colorSchemeVars["grey-1"]} 11px, ${colorSchemeVars["grey-0"]} 11px, ${colorSchemeVars["grey-0"]} 22px)`,
                    }}
                >
                    <Box
                        as="span"
                        fontSize="50"
                        fontStyle="code"
                        color="grey-40"
                        backgroundColor="grey-0"
                        border="grey-5"
                        borderRadius="1.5"
                        paddingX="3"
                        paddingY="1.5"
                    >
                        {label ?? "product screenshot"}
                    </Box>
                </Box>
            </Box>
            {caption !== undefined ? (
                <Box as="figcaption" fontSize="75" color="grey-40" marginTop="2" textAlign="center">
                    {caption}
                </Box>
            ) : null}
        </Box>
    ),
    markdown: props => {
        const label = typeof props.label === "string" ? props.label : "product screenshot";
        const caption = typeof props.caption === "string" ? props.caption : "";
        const lines = [`[${label}]`, ...(caption.length > 0 ? [caption] : [])];
        return `${lines.map(line => `> ${line}`).join("\n")}\n\n`;
    },
});
