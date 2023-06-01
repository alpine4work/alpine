import {Box} from "~/client/design/box";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function TaskNotepadViewActiveSection() {
    const cardGap: Spacing = "3";
    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[cardGap]) * (2 / 3)
    }rem)`;

    const mockCardHeight = "6.5rem";
    const illustrationWidth = "10rem";
    const minTextWidth = "9.75rem";

    return (
        <Box paddingX="5">
            <Box paddingBottom="2" fontSize="100" fontStyle="semi-bold">
                Active
            </Box>
            <Box display="flex" gap={cardGap}>
                <Box
                    position="relative"
                    zIndex="0"
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    overflow="hidden"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        // Use a box shadow for the border since cards use elevation for their border
                        // which uses a box shadow. So this means our placeholders have
                        // consistent layout.
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                >
                    <Box
                        position="absolute"
                        left="0"
                        bottom="0"
                        padding="4"
                        style={{width: `calc(100% - ${illustrationWidth})`, minWidth: minTextWidth}}
                    >
                        <Box fontSize="75" fontStyle="semi-bold" color="grey-70" paddingBottom="1">
                            Mark tasks as active
                        </Box>
                        <Box fontSize="50" color="grey-50">
                            Active tasks help you track what you’re currently working on
                        </Box>
                    </Box>
                    <Box
                        position="absolute"
                        right="0"
                        top="4"
                        bottom="0"
                        style={{width: illustrationWidth, maxWidth: `calc(100% - ${minTextWidth})`}}
                    >
                        <Box
                            position="absolute"
                            top="0"
                            left="0"
                            width="64"
                            height="64"
                            borderRadius="xl"
                            boxShadow="elevation-20"
                            padding="4"
                            display="flex"
                            flexDirection="column"
                            gap="4"
                            style={{
                                transformOrigin: "top left",
                                // Just a little bit of rotation so it's clear this is an illustration, not
                                // application UI.
                                transform: "rotate(2deg)",
                            }}
                        >
                            <svg
                                // `cursor-arrow-rays` icon from Heroicons
                                // https://heroicons.com
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className={sprinkles({
                                    position: "absolute",
                                    zIndex: "10",
                                    width: "5",
                                    height: "5",
                                })}
                                style={{
                                    transform: "rotate(-25deg)",
                                    left: "5.75rem",
                                    top: "1.625rem",
                                    fill: colorSchemeVars["grey-text"],
                                }}
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M12 1.5a.75.75 0 01.75.75V4.5a.75.75 0 01-1.5 0V2.25A.75.75 0 0112 1.5zM5.636 4.136a.75.75 0 011.06 0l1.592 1.591a.75.75 0 01-1.061 1.06l-1.591-1.59a.75.75 0 010-1.061zm12.728 0a.75.75 0 010 1.06l-1.591 1.592a.75.75 0 01-1.06-1.061l1.59-1.591a.75.75 0 011.061 0zm-6.816 4.496a.75.75 0 01.82.311l5.228 7.917a.75.75 0 01-.777 1.148l-2.097-.43 1.045 3.9a.75.75 0 01-1.45.388l-1.044-3.899-1.601 1.42a.75.75 0 01-1.247-.606l.569-9.47a.75.75 0 01.554-.68zM3 10.5a.75.75 0 01.75-.75H6a.75.75 0 010 1.5H3.75A.75.75 0 013 10.5zm14.25 0a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H18a.75.75 0 01-.75-.75zm-8.962 3.712a.75.75 0 010 1.061l-1.591 1.591a.75.75 0 11-1.061-1.06l1.591-1.592a.75.75 0 011.06 0z"
                                    clipRule="evenodd"
                                />
                            </svg>
                            <Box display="flex" alignItems="center" gap="2.5">
                                <Box
                                    position="relative"
                                    width="6"
                                    height="6"
                                    borderRadius="full"
                                    border="grey-40"
                                >
                                    <Box
                                        position="absolute"
                                        top="0"
                                        left="0"
                                        height="6"
                                        overflow="hidden"
                                        style={{
                                            width: `${parseRemLengthNumber(spacing["6"]) / 2}rem`,
                                            transform: `translate(-1px, -1px) translateX(${
                                                parseRemLengthNumber(spacing["6"]) / 2
                                            }rem) scale(${(16 - 5) / 16})`,
                                            transformOrigin: "center left",
                                        }}
                                    >
                                        <Box
                                            position="absolute"
                                            top="0"
                                            right="0"
                                            width="6"
                                            height="6"
                                            borderRadius="full"
                                            backgroundColor={{
                                                light: "theme-20-const",
                                                dark: "theme-30-const",
                                            }}
                                        />
                                    </Box>
                                </Box>
                                <Box
                                    fontSize="100"
                                    color="grey-70"
                                    display="flex"
                                    alignItems="center"
                                >
                                    Active
                                </Box>
                            </Box>
                            <Box
                                width="full"
                                height="5"
                                borderRadius="full"
                                backgroundColor="grey-5"
                                style={{opacity: 0.6}}
                            />
                        </Box>
                    </Box>
                </Box>
                <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        // Use a box shadow for the border since cards use elevation for their border
                        // which uses a box shadow. So this means our placeholders have
                        // consistent layout.
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                />
                <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        // Use a box shadow for the border since cards use elevation for their border
                        // which uses a box shadow. So this means our placeholders have
                        // consistent layout.
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                />
            </Box>
        </Box>
    );
}
