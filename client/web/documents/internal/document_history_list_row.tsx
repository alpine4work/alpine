import {assignInlineVars} from "@vanilla-extract/dynamic";
import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {RemLength, negateRemLength} from "~/shared/design/core/spacing.js";

export function DocumentHistoryListRow({
    isSelected,
    withTopBorder = false,
    withoutBottomBorder = false,
    selectedBackgroundLeftOutset = "0rem",
    selectedBackgroundTopOutset,
    children,
}: {
    isSelected: boolean;
    withTopBorder?: boolean;
    withoutBottomBorder?: boolean;
    // Keep nested entry content indented. Its selected background still matches the
    // parent row width.
    selectedBackgroundLeftOutset?: RemLength;
    // Cover the parent-row divider across the expanded-list gap.
    selectedBackgroundTopOutset?: RemLength;
    children: ReactNode;
}) {
    return (
        <Box paddingX="1" style={{marginTop: withTopBorder ? 1 : undefined}}>
            <Box
                position="relative"
                zIndex="0"
                style={
                    isSelected
                        ? assignInlineVars({[backgroundColorVar]: colorSchemeVars["grey-5"]})
                        : undefined
                }
            >
                {isSelected ? (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-10"
                        borderRadius="1.5"
                        backgroundColor="grey-5"
                        // Cover the separator drawn by the entry below, matching Inbox selection.
                        style={{
                            top:
                                selectedBackgroundTopOutset === undefined
                                    ? withTopBorder
                                        ? -1
                                        : 0
                                    : negateRemLength(selectedBackgroundTopOutset),
                            bottom: -2,
                            left: negateRemLength(selectedBackgroundLeftOutset),
                        }}
                    />
                ) : (
                    <Box
                        position="absolute"
                        top="0"
                        bottom="0"
                        left="2.5"
                        right="2.5"
                        zIndex="-10"
                        // A box shadow preserves the row's layout while drawing the Inbox-style divider.
                        style={{
                            boxShadow: [
                                withTopBorder ? `0 -1px 0 0 ${colorSchemeVars["grey-5"]}` : null,
                                !withoutBottomBorder
                                    ? `0 1px 0 0 ${colorSchemeVars["grey-5"]}`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(", "),
                        }}
                    />
                )}
                {children}
            </Box>
        </Box>
    );
}
