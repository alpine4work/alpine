import {X} from "phosphor-react";
import {useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {DocumentHistoryEntryRow} from "~/client/web/documents/internal/document_history_entry_row.js";
import {DocumentHistoryGroupRow} from "~/client/web/documents/internal/document_history_group_row.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {DocumentHistoryGroup} from "~/shared/documents/document_history_model.js";
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

            <Box flexGrow="1" minHeight="0" overflowY="auto">
                {groups.length === 0 ? (
                    <Box padding="4" color="grey-60" textAlign="center">
                        No saved versions yet.
                    </Box>
                ) : (
                    groups.map(group => {
                        const isExpandable = group.entries.length > 1;
                        const isExpanded =
                            isExpandable && expandedGroupEndVersions.has(group.endVersion);
                        const isSelected =
                            selection.type === "Group" && selection.endVersion === group.endVersion;

                        return (
                            <Box key={group.endVersion}>
                                <DocumentHistoryGroupRow
                                    group={group}
                                    accountById={accountById}
                                    isExpandable={isExpandable}
                                    isExpanded={isExpanded}
                                    isSelected={isSelected}
                                    onSelect={() => onSelectGroup(group)}
                                    onToggleExpanded={() => {
                                        setExpandedGroupEndVersions(previous => {
                                            const next = new Set(previous);
                                            if (next.has(group.endVersion)) {
                                                next.delete(group.endVersion);
                                            } else {
                                                next.add(group.endVersion);
                                            }
                                            return next;
                                        });
                                    }}
                                />
                                {isExpanded && (
                                    <Box
                                        marginTop="0.5"
                                        paddingLeft="1.5"
                                        style={{marginLeft: addRemLengths("1", "2.5")}}
                                    >
                                        {group.entries.map(entry => (
                                            <DocumentHistoryEntryRow
                                                key={`${entry.startVersion}:${entry.endVersion}`}
                                                entry={entry}
                                                accountById={accountById}
                                                isSelected={
                                                    selection.type === "Entry" &&
                                                    selection.endVersion === entry.endVersion
                                                }
                                                onPress={() => onSelectEntry(entry)}
                                            />
                                        ))}
                                    </Box>
                                )}
                            </Box>
                        );
                    })
                )}
            </Box>
        </Box>
    );
}
