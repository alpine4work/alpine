import {groupDocumentHistoryTransactions} from "~/shared/documents/document_history_grouping.js";
import {
    DocumentHistoryAuthor,
    DocumentHistoryTransactionMetadata,
} from "~/shared/documents/document_history_model.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const account1Id = generateId<AccountId>();
const account2Id = generateId<AccountId>();
const botAccountId = generateId<AccountId>();

const account1Author: DocumentHistoryAuthor = {id: account1Id, from: null};
const account2Author: DocumentHistoryAuthor = {id: account2Id, from: null};
const botAuthor: DocumentHistoryAuthor = {
    id: account1Id,
    from: {type: "Bot", accountId: botAccountId},
};

function createTransaction({
    minute,
    startVersion,
    author = account1Author,
}: {
    minute: number;
    startVersion: number;
    author?: DocumentHistoryAuthor;
}): DocumentHistoryTransactionMetadata {
    return {
        startVersion,
        endVersion: startVersion + 1,
        createdTime: new Date(Date.UTC(2026, 1, 17, 13, minute)),
        author,
        clientId: generateId<ContentEditorClientId>(),
    };
}

test("splits top-level groups after a gap greater than 60 minutes", () => {
    const groups = groupDocumentHistoryTransactions([
        createTransaction({minute: 0, startVersion: 0}),
        createTransaction({minute: 60, startVersion: 1}),
        createTransaction({minute: 121, startVersion: 2}),
    ]);

    expect(
        groups.map(group => ({
            startVersion: group.startVersion,
            endVersion: group.endVersion,
            entryCount: group.entries.length,
        })),
    ).toEqual([
        {startVersion: 2, endVersion: 3, entryCount: 1},
        {startVersion: 0, endVersion: 2, entryCount: 2},
    ]);
});

test("caps continuous typing bursts at five minutes", () => {
    const groups = groupDocumentHistoryTransactions(
        Array.from({length: 9}, (_, minute) => createTransaction({minute, startVersion: minute})),
    );

    expect(
        groups[0]?.entries.map(entry => ({
            startVersion: entry.startVersion,
            endVersion: entry.endVersion,
        })),
    ).toEqual([
        {startVersion: 5, endVersion: 9},
        {startVersion: 0, endVersion: 5},
    ]);
});

test("splits typing bursts after breaks greater than one minute", () => {
    const groups = groupDocumentHistoryTransactions([
        createTransaction({minute: 0, startVersion: 0}),
        createTransaction({minute: 3, startVersion: 1}),
        createTransaction({minute: 6, startVersion: 2}),
    ]);

    expect(
        groups[0]?.entries.map(entry => ({
            startVersion: entry.startVersion,
            endVersion: entry.endVersion,
        })),
    ).toEqual([
        {startVersion: 2, endVersion: 3},
        {startVersion: 1, endVersion: 2},
        {startVersion: 0, endVersion: 1},
    ]);
});

test("keeps collaborators in one time burst and retains bot-aware contributors", () => {
    const groups = groupDocumentHistoryTransactions([
        createTransaction({minute: 0, startVersion: 0, author: account1Author}),
        createTransaction({minute: 1, startVersion: 1, author: account2Author}),
        createTransaction({minute: 2, startVersion: 2, author: botAuthor}),
        createTransaction({minute: 3, startVersion: 3, author: account1Author}),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.contributors).toEqual([account1Author, account2Author, botAuthor]);
    expect(groups[0]?.entries).toHaveLength(1);
    expect(groups[0]?.entries[0]?.contributors).toEqual([
        account1Author,
        account2Author,
        botAuthor,
    ]);
});

test("normalizes accumulated newest-first pages before grouping", () => {
    const groups = groupDocumentHistoryTransactions([
        createTransaction({minute: 2, startVersion: 2}),
        createTransaction({minute: 1, startVersion: 1}),
        createTransaction({minute: 0, startVersion: 0}),
    ]);

    expect(groups[0]?.startVersion).toBe(0);
    expect(groups[0]?.endVersion).toBe(3);
});
