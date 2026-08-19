import {
    DocumentHistoryAuthor,
    DocumentHistoryGroup,
    DocumentHistorySubEntry,
    DocumentHistoryTransactionMetadata,
    documentHistoryDiffMaxStepCount,
} from "~/shared/documents/document_history_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

const documentHistoryGroupGapMs = 60 * 60 * 1000;
const documentHistoryEntryGapMs = 60 * 1000;
const documentHistoryEntryDurationMs = 5 * 60 * 1000;

type MutableDocumentHistoryContributors = {
    contributors: Array<DocumentHistoryAuthor>;
    contributorKeys: Set<string>;
};

type MutableDocumentHistorySubEntry = MutableDocumentHistoryContributors & {
    startVersion: number;
    endVersion: number;
    startTime: Date;
    endTime: Date;
};

type MutableDocumentHistoryGroup = MutableDocumentHistoryContributors & {
    startVersion: number;
    endVersion: number;
    startTime: Date;
    endTime: Date;
    entries: Array<MutableDocumentHistorySubEntry>;
};

/**
 * Groups transaction metadata into newest-first history groups and time bursts.
 * Input may contain accumulated newest-first pages or already sorted transactions.
 */
export function groupDocumentHistoryTransactions(
    transactions: ReadonlyArray<DocumentHistoryTransactionMetadata>,
): ReadonlyArray<DocumentHistoryGroup> {
    const orderedTransactions = [...transactions].sort(
        (transaction1, transaction2) => transaction1.startVersion - transaction2.startVersion,
    );
    const groups: Array<MutableDocumentHistoryGroup> = [];

    for (const transaction of orderedTransactions) {
        const previousGroup = groups.at(-1);
        const previousTransactionTime = previousGroup?.endTime;
        const shouldStartGroup =
            !previousTransactionTime ||
            transaction.createdTime.getTime() - previousTransactionTime.getTime() >
                documentHistoryGroupGapMs ||
            transaction.endVersion - assertExists(previousGroup).startVersion >
                documentHistoryDiffMaxStepCount;

        if (shouldStartGroup) {
            groups.push(createGroup(transaction, previousGroup?.endVersion));
            continue;
        }

        const group = assertExists(previousGroup);
        const entry = assertExists(group.entries.at(-1));
        const shouldStartEntry =
            transaction.createdTime.getTime() - group.endTime.getTime() >
                documentHistoryEntryGapMs ||
            transaction.createdTime.getTime() - entry.startTime.getTime() >=
                documentHistoryEntryDurationMs ||
            transaction.endVersion - entry.startVersion > documentHistoryDiffMaxStepCount;

        group.endVersion = transaction.endVersion;
        group.endTime = transaction.createdTime;
        addContributor(group, transaction.author);

        if (shouldStartEntry) {
            group.entries.push(createEntry(transaction));
        } else {
            entry.endVersion = transaction.endVersion;
            entry.endTime = transaction.createdTime;
            addContributor(entry, transaction.author);
        }
    }

    return groups.reverse().map(
        (group): DocumentHistoryGroup => ({
            startVersion: group.startVersion,
            endVersion: group.endVersion,
            startTime: group.startTime,
            endTime: group.endTime,
            contributors: group.contributors,
            entries: group.entries.reverse().map(
                (entry): DocumentHistorySubEntry => ({
                    startVersion: entry.startVersion,
                    endVersion: entry.endVersion,
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    contributors: entry.contributors,
                }),
            ),
        }),
    );
}

function createGroup(
    transaction: DocumentHistoryTransactionMetadata,
    previousGroupEndVersion: number | undefined,
): MutableDocumentHistoryGroup {
    const group: MutableDocumentHistoryGroup = {
        startVersion: previousGroupEndVersion ?? transaction.startVersion,
        endVersion: transaction.endVersion,
        startTime: transaction.createdTime,
        endTime: transaction.createdTime,
        contributors: [],
        contributorKeys: new Set(),
        entries: [createEntry(transaction)],
    };
    addContributor(group, transaction.author);
    return group;
}

function createEntry(
    transaction: DocumentHistoryTransactionMetadata,
): MutableDocumentHistorySubEntry {
    return {
        startVersion: transaction.startVersion,
        endVersion: transaction.endVersion,
        startTime: transaction.createdTime,
        endTime: transaction.createdTime,
        contributors: [transaction.author],
        contributorKeys: new Set([getDocumentHistoryAuthorKey(transaction.author)]),
    };
}

function addContributor(
    item: MutableDocumentHistoryContributors,
    author: DocumentHistoryAuthor,
): void {
    const authorKey = getDocumentHistoryAuthorKey(author);
    if (item.contributorKeys.has(authorKey)) return;

    item.contributorKeys.add(authorKey);
    item.contributors.push(author);
}

function getDocumentHistoryAuthorKey(author: DocumentHistoryAuthor): string {
    if (author.from === null) {
        return author.id ? `Account:${author.id}` : "Unknown";
    }

    switch (author.from.type) {
        case "Bot":
            return `Bot:${author.from.accountId}:${author.id ?? ""}`;
        case "Importer":
            return `Importer:${author.from.source.type}:${author.id ?? ""}`;
        default:
            throw exhaustive(author.from);
    }
}
