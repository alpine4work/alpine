import {Box} from "~/client/design/box";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/styles";

export function TaskNotepadViewActiveSection() {
    const cardGap: Spacing = "3";
    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[cardGap]) * (2 / 3)
    }rem)`;

    const mockCardHeight = "6.5rem";

    return (
        <Box paddingX="5">
            <Box paddingBottom="2" fontSize="100" fontStyle="semi-bold">
                Active
            </Box>
            <Box display="flex" gap={cardGap}>
                <Box
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
                />
                <Box
                    maxWidth={taskCardViewMaxWidth}
                    borderRadius="lg"
                    style={{
                        width: cardWidth,
                        height: mockCardHeight,
                        boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                    }}
                />
            </Box>
        </Box>
    );
}
