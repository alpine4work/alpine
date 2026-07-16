import {Children, ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";
import {indentDocumentationMarkdownContinuationLines} from "~/client/web/docs/internal/markdown/indent_documentation_markdown_continuation_lines.js";

/**
 * A numbered walkthrough. Each step gets an accent-tinted pill number joined to
 * the next by a hairline connector. In markdown it becomes a numbered list.
 *
 * ```mdx
 * <Steps>
 *     <Step title="Create a document">Click + in the sidebar.</Step>
 *     <Step title="Share it">Click Share in the top-right.</Step>
 * </Steps>
 * ```
 */
export const DocumentationSteps = documentationComponent({
    react: ({children}: {children?: ReactNode}) => {
        const steps = Children.toArray(children);
        return (
            <Box position="relative" marginY="5" display="flex" flexDirection="column">
                {steps.map((step, index) => (
                    <Box
                        key={index}
                        display="flex"
                        gap="4"
                        position="relative"
                        paddingBottom={index < steps.length - 1 ? "5" : "0"}
                    >
                        <Box position="relative" flexShrink="0">
                            {index < steps.length - 1 ? (
                                <Box
                                    position="absolute"
                                    backgroundColor="grey-10"
                                    style={{left: 13, top: 30, bottom: -2, width: 1}}
                                />
                            ) : null}
                            <Box
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                width="7"
                                height="7"
                                borderRadius="full"
                                backgroundColor="theme-10"
                                color="theme-60"
                                border="grey-5"
                                fontSize="75"
                                fontStyle="semi-bold"
                                position="relative"
                                zIndex="10"
                            >
                                {index + 1}
                            </Box>
                        </Box>
                        <Box paddingTop="0.5" flex="1" minWidth="flex-fit">
                            {step}
                        </Box>
                    </Box>
                ))}
            </Box>
        );
    },
    markdown: props => {
        const steps = documentationMarkdownChildItems(props.children);
        return `${steps
            .map((step, index) => {
                const marker = `${index + 1}. `;
                return marker + indentDocumentationMarkdownContinuationLines(step, marker.length);
            })
            .join("\n")}\n\n`;
    },
});
