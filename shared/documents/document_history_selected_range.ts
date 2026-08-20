import {
    DocumentHistoryGroup,
    DocumentHistoryVersionRange,
} from "~/shared/documents/document_history_model.js";

export type DocumentHistorySelectedRange =
    | {
          readonly type: "Group";
          readonly endVersion: number;
          readonly range: DocumentHistoryVersionRange;
          readonly showInitialContentAsAdditions: boolean;
      }
    | {
          readonly type: "Entry";
          readonly endVersion: number;
          readonly parentGroupEndVersion: number;
          readonly range: DocumentHistoryVersionRange;
          readonly showInitialContentAsAdditions: boolean;
      };

/** Finds the history group or entry identified by a version-history URL. */
export function getDocumentHistorySelectedRange({
    groups,
    version,
    isGroupSelection,
    initialVersionCreatedTime,
}: {
    groups: ReadonlyArray<DocumentHistoryGroup>;
    version: number | null;
    isGroupSelection: boolean;
    initialVersionCreatedTime: Date | null;
}): DocumentHistorySelectedRange | null {
    if (version === null) {
        const firstGroup = groups[0];
        if (!firstGroup) return null;

        return {
            type: "Group",
            endVersion: firstGroup.endVersion,
            range: {
                startVersion: firstGroup.startVersion,
                endVersion: firstGroup.endVersion,
            },
            showInitialContentAsAdditions: documentHistoryItemIncludesInitialVersion(
                firstGroup,
                initialVersionCreatedTime,
            ),
        };
    }

    if (isGroupSelection) {
        const group = findDocumentHistoryItemAtVersion(groups, version);
        if (!group) return null;
        return {
            type: "Group",
            endVersion: group.endVersion,
            range: {startVersion: group.startVersion, endVersion: group.endVersion},
            showInitialContentAsAdditions: documentHistoryItemIncludesInitialVersion(
                group,
                initialVersionCreatedTime,
            ),
        };
    }

    const entry = findDocumentHistoryEntryAtVersion(groups, version);
    if (!entry) return null;

    return {
        type: "Entry",
        endVersion: entry.endVersion,
        parentGroupEndVersion: entry.parentGroupEndVersion,
        range: {startVersion: entry.startVersion, endVersion: entry.endVersion},
        showInitialContentAsAdditions: documentHistoryItemIncludesInitialVersion(
            entry,
            initialVersionCreatedTime,
        ),
    };
}

function documentHistoryItemIncludesInitialVersion(
    item: {startVersion: number; startTime: Date},
    initialVersionCreatedTime: Date | null,
): boolean {
    return (
        initialVersionCreatedTime !== null &&
        item.startVersion === 0 &&
        item.startTime.getTime() === initialVersionCreatedTime.getTime()
    );
}

type DocumentHistoryEntryWithParentGroup = DocumentHistoryGroup["entries"][number] & {
    readonly parentGroupEndVersion: number;
};

function findDocumentHistoryEntryAtVersion(
    groups: ReadonlyArray<DocumentHistoryGroup>,
    version: number,
): DocumentHistoryEntryWithParentGroup | undefined {
    let containingEntry: DocumentHistoryEntryWithParentGroup | undefined;
    let startingEntry: DocumentHistoryEntryWithParentGroup | undefined;

    for (const group of groups) {
        for (const entry of group.entries) {
            if (entry.endVersion === version) {
                return {...entry, parentGroupEndVersion: group.endVersion};
            }

            if (entry.startVersion < version && version < entry.endVersion) {
                containingEntry ??= {...entry, parentGroupEndVersion: group.endVersion};
                continue;
            }

            if (entry.startVersion === version) {
                startingEntry ??= {...entry, parentGroupEndVersion: group.endVersion};
            }
        }
    }

    // Adjacent entries share a boundary. A selected version identifies a document
    // state, so prefer the entry which ends at that state over the subsequent entry
    // which starts there.
    return containingEntry ?? startingEntry;
}

function findDocumentHistoryItemAtVersion<Item extends DocumentHistoryVersionRange>(
    items: ReadonlyArray<Item>,
    version: number,
): Item | undefined {
    let containingItem: Item | undefined;
    let startingItem: Item | undefined;

    for (const item of items) {
        if (item.endVersion === version) {
            return item;
        }

        if (item.startVersion < version && version < item.endVersion) {
            containingItem ??= item;
            continue;
        }

        if (item.startVersion === version) {
            startingItem ??= item;
        }
    }

    // Adjacent ranges share a boundary: the earlier range ends at the version where
    // the following range starts. A selected version identifies a document state, so
    // prefer the range which ends at that state over the subsequent change that starts
    // there.
    return containingItem ?? startingItem;
}
