import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {ColorSchemeVar} from "~/client/web/styles/styles.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type DocumentationCalloutType = "info" | "tip" | "warning";

function getCalloutColors(type: DocumentationCalloutType): {
    backgroundColor: ColorSchemeVar;
    color: ColorSchemeVar;
    glyph: string;
} {
    switch (type) {
        case "info":
            return {backgroundColor: "indigo-10", color: "indigo-80", glyph: "ℹ"};
        case "tip":
            return {backgroundColor: "green-10", color: "green-80", glyph: "✦"};
        case "warning":
            return {backgroundColor: "orange-10", color: "orange-80", glyph: "▲"};
        default:
            throw exhaustive(type);
    }
}

/**
 * A tinted rounded callout card for guide asides. The tint families match the
 * app's palette: info = indigo, tip = green, warning = orange. In markdown it
 * becomes a GitHub-style alert blockquote.
 */
export const DocumentationCallout = documentationComponent({
    react: ({
        type = "info",
        title,
        children,
    }: {
        type?: DocumentationCalloutType;
        title?: string;
        children?: ReactNode;
    }) => {
        const colors = getCalloutColors(type);
        return (
            <Box
                display="flex"
                gap="3"
                padding="4"
                borderRadius="2.5"
                backgroundColor={colors.backgroundColor}
                marginY="5"
            >
                <Box as="span" color={colors.color} fontSize="100" fontStyle="bold" flexShrink="0">
                    {colors.glyph}
                </Box>
                <Box display="flex" flexDirection="column" gap="0.5" minWidth="flex-fit">
                    {title !== undefined ? (
                        <Box fontSize="75" fontStyle="bold" color={colors.color}>
                            {title}
                        </Box>
                    ) : null}
                    {children !== undefined ? (
                        <Box
                            fontSize="75"
                            color={colors.color}
                            opacity="90"
                            style={{lineHeight: 1.55}}
                        >
                            {children}
                        </Box>
                    ) : null}
                </Box>
            </Box>
        );
    },
    markdown: props => {
        const type: DocumentationCalloutType =
            props.type === "tip" || props.type === "warning" ? props.type : "info";
        const alert = type === "warning" ? "WARNING" : type === "tip" ? "TIP" : "NOTE";
        const title = typeof props.title === "string" ? props.title : "";
        const body = flattenDocumentationMarkdownChildren(props.children).trim();

        const lines = [
            `[!${alert}]`,
            ...(title.length > 0 ? [`**${title}**`] : []),
            ...(body.length > 0 ? [body] : []),
        ]
            .join("\n")
            .split("\n");
        return `${lines.map(line => (line.length > 0 ? `> ${line}` : ">")).join("\n")}\n\n`;
    },
});
