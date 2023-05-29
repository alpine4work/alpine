import {Box} from "~/client/design/box";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {contentSchemaStyles} from "~/shared/styles/styles";

export function TaskNotepadViewActiveSection() {
    const cardGap: Spacing = "3";
    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[cardGap]) * (2 / 3)
    }rem)`;

    return (
        <Box paddingX="5">
            <Box paddingBottom="2" fontSize="100" fontStyle="semi-bold">
                Active
            </Box>
            <Box display="flex" gap={cardGap}>
                <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    padding="4"
                    display="flex"
                    flexDirection="column"
                    gap="4"
                    boxShadow="elevation-5"
                    style={{width: cardWidth}}
                >
                    <Box display="flex" gap="2">
                        <Box
                            flexShrink="0"
                            display="flex"
                            alignItems="center"
                            style={{height: contentSchemaStyles.paragraphFontSize.lineHeight}}
                        >
                            <Box
                                position="relative"
                                width="4"
                                height="4"
                                borderRadius="full"
                                border="grey-10"
                            >
                                <Box
                                    position="absolute"
                                    top="0"
                                    left="0"
                                    height="4"
                                    width="2"
                                    overflow="hidden"
                                    style={{
                                        transform: `translate(-1px, -1px) translateX(${
                                            spacing["2"]
                                        }) scale(${(16 - 5) / 16})`,
                                        transformOrigin: "center left",
                                    }}
                                >
                                    <Box
                                        position="absolute"
                                        top="0"
                                        right="0"
                                        width="4"
                                        height="4"
                                        borderRadius="full"
                                        backgroundColor="grey-10"
                                    />
                                </Box>
                            </Box>
                        </Box>
                        <Box
                            flexGrow="1"
                            display="flex"
                            alignItems="center"
                            color="grey-50"
                            style={contentSchemaStyles.paragraphFontSize}
                        >
                            Mark tasks you’re currently working on as active
                        </Box>
                    </Box>
                    <Box display="flex" gap="2">
                        <Box width="16" height="4" backgroundColor="grey-5" borderRadius="base" />
                        <Box width="16" height="4" backgroundColor="grey-5" borderRadius="base" />
                    </Box>
                </Box>
                {/* <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                />
                <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                /> */}
            </Box>
        </Box>
    );
}
