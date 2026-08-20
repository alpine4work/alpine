import {X} from "phosphor-react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {DocumentHistoryEntryRow} from "~/client/web/documents/internal/document_history_entry_row.js";
import {DocumentHistoryGroupRow} from "~/client/web/documents/internal/document_history_group_row.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {RemLength, addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {DocumentHistoryGroup} from "~/shared/documents/document_history_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type DocumentHistoryListViewSelection =
    | {readonly type: "None"}
    | {readonly type: "Group"; readonly endVersion: number}
    | {
          readonly type: "Entry";
          readonly endVersion: number;
          readonly parentGroupEndVersion: number;
      };

type DocumentHistoryListItem =
    | {readonly type: "Group"; readonly group: DocumentHistoryGroup}
    | {
          readonly type: "Entry";
          readonly entry: DocumentHistoryGroup["entries"][number];
          readonly isFirstEntryInGroup: boolean;
      };

const documentHistoryGroupRowMinHeight: RemLength = spacing["10"];
const documentHistoryEntryRowMinHeight: RemLength = spacing["9"];

export function DocumentHistoryListView({
    groups,
    accountById,
    selection,
    onSelectGroup,
    onSelectEntry,
    onClose,
}: {
    groups: ReadonlyArray<DocumentHistoryGroup>;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    selection: DocumentHistoryListViewSelection;
    onSelectGroup: (group: DocumentHistoryGroup) => void;
    onSelectEntry: (entry: DocumentHistoryGroup["entries"][number]) => void;
    onClose: () => void;
}) {
    const [expandedGroupEndVersions, setExpandedGroupEndVersions] = useState<Set<number>>(() =>
        selection.type === "Entry" ? new Set([selection.parentGroupEndVersion]) : new Set(),
    );

    useEffect(() => {
        if (selection.type !== "Entry") return;

        setExpandedGroupEndVersions(previous => {
            if (previous.has(selection.parentGroupEndVersion)) return previous;
            return new Set([...previous, selection.parentGroupEndVersion]);
        });
    }, [selection]);

    const items = useMemo((): ReadonlyArray<DocumentHistoryListItem> => {
        const items: Array<DocumentHistoryListItem> = [];

        for (const group of groups) {
            items.push({type: "Group", group});
            if (!expandedGroupEndVersions.has(group.endVersion)) continue;

            for (const [entryIndex, entry] of group.entries.entries()) {
                items.push({type: "Entry", entry, isFirstEntryInGroup: entryIndex === 0});
            }
        }

        return items;
    }, [expandedGroupEndVersions, groups]);

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            const item = assertExists(items[index], "Document history item index is out of bounds");

            switch (item.type) {
                case "Group": {
                    const isExpandable = item.group.entries.length > 1;
                    const isExpanded =
                        isExpandable && expandedGroupEndVersions.has(item.group.endVersion);
                    const isSelected =
                        selection.type === "Group" &&
                        selection.endVersion === item.group.endVersion;

                    return {
                        key: `Group:${item.group.endVersion}`,
                        minHeight: documentHistoryGroupRowMinHeight,
                        node: (
                            <DocumentHistoryGroupRow
                                group={item.group}
                                accountById={accountById}
                                isExpandable={isExpandable}
                                isExpanded={isExpanded}
                                isSelected={isSelected}
                                onSelect={() => onSelectGroup(item.group)}
                                onToggleExpanded={() => {
                                    setExpandedGroupEndVersions(previous => {
                                        const next = new Set(previous);
                                        if (next.has(item.group.endVersion)) {
                                            next.delete(item.group.endVersion);
                                        } else {
                                            next.add(item.group.endVersion);
                                        }
                                        return next;
                                    });
                                }}
                            />
                        ),
                    };
                }
                case "Entry":
                    return {
                        key: `Entry:${item.entry.startVersion}:${item.entry.endVersion}`,
                        minHeight: documentHistoryEntryRowMinHeight,
                        node: (
                            <Box
                                marginTop={item.isFirstEntryInGroup ? "0.5" : undefined}
                                paddingLeft="1.5"
                                style={{marginLeft: addRemLengths("1", "2.5")}}
                            >
                                <DocumentHistoryEntryRow
                                    entry={item.entry}
                                    accountById={accountById}
                                    isSelected={
                                        selection.type === "Entry" &&
                                        selection.endVersion === item.entry.endVersion
                                    }
                                    onPress={() => onSelectEntry(item.entry)}
                                />
                            </Box>
                        ),
                    };
                default:
                    throw exhaustive(item);
            }
        },
        [accountById, expandedGroupEndVersions, items, onSelectEntry, onSelectGroup, selection],
    );

    return (
        <Box
            height="full"
            width="full"
            display="flex"
            flexDirection="column"
            backgroundColor="grey-0"
        >
            <Box
                height={navigationBarHeight}
                flexShrink="0"
                paddingLeft="3"
                position="relative"
                zIndex="0"
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" minWidth="0">
                    <Box as="h2" margin="0" fontSize="300" fontStyle="truncate-semi-bold">
                        Version history
                    </Box>
                </Box>
                <Box
                    flexShrink="0"
                    width="10"
                    paddingRight="5"
                    display="flex"
                    justifyContent="flex-end"
                >
                    <IconButton
                        size="md"
                        description="Close"
                        withoutTooltip={true}
                        onPress={onClose}
                    >
                        <X />
                    </IconButton>
                </Box>
                {/* Keep the separator outside the shared nav-bar height. */}
                <Box
                    position="absolute"
                    zIndex="-10"
                    left="0"
                    right="0"
                    height="border"
                    backgroundColor="grey-5-translucent"
                    style={{bottom: -1}}
                />
            </Box>

            <Box flexGrow="1" minHeight="0">
                {groups.length === 0 ? (
                    <Box padding="4" color="grey-60" textAlign="center">
                        No saved versions yet.
                    </Box>
                ) : (
                    <VirtualizedScrollView
                        itemCount={items.length}
                        bufferedItemHeight={documentHistoryGroupRowMinHeight}
                        renderItem={renderItem}
                    />
                )}
            </Box>
        </Box>
    );
}
