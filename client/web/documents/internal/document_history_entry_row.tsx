import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {DocumentHistoryContributors} from "~/client/web/documents/internal/document_history_contributors.js";
import {DocumentHistoryListRow} from "~/client/web/documents/internal/document_history_list_row.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {DocumentHistorySubEntry} from "~/shared/documents/document_history_model.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function DocumentHistoryEntryRow({
    entry,
    accountById,
    isSelected,
    onPress,
}: {
    entry: DocumentHistorySubEntry;
    accountById: ReadonlyMap<AccountId, AccountModel>;
    isSelected: boolean;
    onPress: () => void;
}) {
    return (
        <DocumentHistoryListRow
            isSelected={isSelected}
            withoutBottomBorder={true}
            selectedBackgroundLeftOutset={addRemLengths("1", "2.5", "1.5")}
            selectedBackgroundTopOutset={addRemLengths("0.5")}
        >
            <FocusRing offset="inset">
                <Box
                    role="button"
                    tabIndex={0}
                    aria-label="View version entry"
                    paddingLeft="3"
                    paddingRight="3"
                    paddingTop="2.5"
                    paddingBottom="2.5"
                    minWidth="0"
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                    borderRadius="1.5"
                    onPointerDown={onPress}
                    onKeyDown={event => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onPress();
                    }}
                >
                    <Box
                        flexShrink="0"
                        fontSize="75"
                        color="grey-60"
                        style={{fontVariantNumeric: "tabular-nums"}}
                    >
                        <PrettyAbsoluteDate date={entry.endTime} withoutDay={true} />
                    </Box>
                    <Box minWidth="0" flexGrow="1">
                        <DocumentHistoryContributors
                            authors={entry.contributors}
                            accountById={accountById}
                            color="grey-60"
                        />
                    </Box>
                </Box>
            </FocusRing>
        </DocumentHistoryListRow>
    );
}
