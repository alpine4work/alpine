import {CaretRight} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {DocumentHistoryContributors} from "~/client/web/documents/internal/document_history_contributors.js";
import {DocumentHistoryListRow} from "~/client/web/documents/internal/document_history_list_row.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {DocumentHistoryGroup} from "~/shared/documents/document_history_model.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function DocumentHistoryGroupRow({
    group,
    accountById,
    isExpandable,
    isExpanded,
    isSelected,
    onSelect,
    onToggleExpanded,
}: {
    group: DocumentHistoryGroup;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    isExpandable: boolean;
    isExpanded: boolean;
    isSelected: boolean;
    onSelect: () => void;
    onToggleExpanded: () => void;
}) {
    return (
        <DocumentHistoryListRow isSelected={isSelected} withTopBorder={true}>
            <FocusRing offset="inset">
                <Box
                    role="button"
                    tabIndex={0}
                    aria-label="View version group"
                    minWidth="0"
                    width="full"
                    display="flex"
                    alignItems="flex-start"
                    paddingRight="3"
                    paddingTop="2"
                    paddingBottom="1.5"
                    borderRadius="1.5"
                    onPointerDown={onSelect}
                    onKeyDown={event => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onSelect();
                    }}
                >
                    <Box
                        width="6"
                        height="6"
                        marginTop="0.5"
                        marginLeft="1"
                        marginRight="1"
                        flexShrink="0"
                    >
                        {isExpandable && (
                            <Box
                                onPointerDown={event => event.stopPropagation()}
                                onKeyDown={event => event.stopPropagation()}
                            >
                                <IconButton
                                    description={
                                        isExpanded
                                            ? "Collapse version group"
                                            : "Expand version group"
                                    }
                                    aria-expanded={isExpanded}
                                    size="sm"
                                    onPress={onToggleExpanded}
                                >
                                    <CaretRight
                                        size={spacing["4"]}
                                        style={
                                            isExpanded ? {transform: "rotate(90deg)"} : undefined
                                        }
                                    />
                                </IconButton>
                            </Box>
                        )}
                    </Box>
                    <Box
                        minWidth="0"
                        flexGrow="1"
                        display="flex"
                        alignItems="center"
                        gap="1.5"
                        marginTop="0.5"
                    >
                        <Box
                            flexShrink="0"
                            fontSize="100"
                            fontStyle="semi-bold"
                            style={{fontVariantNumeric: "tabular-nums"}}
                        >
                            <PrettyAbsoluteDate date={group.endTime} />
                        </Box>
                        <Box minWidth="0" flexGrow="1">
                            <DocumentHistoryContributors
                                authors={group.contributors}
                                accountById={accountById}
                                fontSize="100"
                                color="grey-100"
                            />
                        </Box>
                    </Box>
                </Box>
            </FocusRing>
        </DocumentHistoryListRow>
    );
}
