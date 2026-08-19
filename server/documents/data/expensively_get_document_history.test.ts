import {DocAttrStep} from "prosemirror-transform";
import {updateDocumentSnapshotForTest} from "~/server/documents/data/documents_actions.js";
import {expensivelyGetDocumentHistory} from "~/server/documents/data/expensively_get_document_history.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const context = createTestContext();

test("loads document history for accounts with comment access", async () => {
    const space = await TestSpace.create(context);
    const [ownerSession, commenterSession] = await space.createSessions(2);
    const document = await TestDocument.create(ownerSession, {
        access: {
            type: "Local",
            accountGrantById: new Map([
                [ownerSession.account.id, {level: "Manage", generation: 0}],
                [commenterSession.account.id, {level: "Comment"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.type(ownerSession, "a");

    const history = await expensivelyGetDocumentHistory(commenterSession.action(), {
        id: document.id,
    });

    expect(history.version).toBe(1);
});

test("does not load document history for accounts without comment access", async () => {
    const space = await TestSpace.create(context);
    const [ownerSession, viewerSession, ungrantedSession] = await space.createSessions(3);
    const document = await TestDocument.create(ownerSession, {
        access: {
            type: "Local",
            accountGrantById: new Map([
                [ownerSession.account.id, {level: "Manage", generation: 0}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await expect(
        expensivelyGetDocumentHistory(viewerSession.action(), {id: document.id}),
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");
    await expect(
        expensivelyGetDocumentHistory(ungrantedSession.action(), {id: document.id}),
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");
});

test("loads document history newest first across a snapshot", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await document.type(session, "a");
    await updateDocumentSnapshotForTest(session.action(), document.id);
    await document.type(session, "b");
    await document.type(session, "c");

    const history = await expensivelyGetDocumentHistory(session.action(), {id: document.id});

    expect(history.transactions.map(transaction => transaction.startVersion)).toEqual([2, 1, 0]);
    expect(history.transactions.map(transaction => transaction.endVersion)).toEqual([3, 2, 1]);
    expect(history.transactions.map(transaction => transaction.author)).toEqual([
        {id: session.account.id, from: null},
        {id: session.account.id, from: null},
        {id: session.account.id, from: null},
    ]);
});

test("leaves attribution unknown when a stored transaction has no account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await document.type(session, "a");
    const transaction = await DocumentsTable.getItem(session.action(), {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "StepTransactionsAfterSnapshot",
        startVersion: 0,
    });
    await DocumentsTable.directlyUpdateItem(session.action(), {...transaction, accountId: null});

    const history = await expensivelyGetDocumentHistory(session.action(), {id: document.id});

    expect(history.transactions.map(transaction => transaction.author)).toEqual([
        {id: null, from: null},
    ]);
});

test("records bots as the source of the human author", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const botSession = await space.createSession();
    const document = await TestDocument.create(session);

    await document.type(session, "a");
    const transaction = await DocumentsTable.getItem(session.action(), {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "StepTransactionsAfterSnapshot",
        startVersion: 0,
    });
    await DocumentsTable.directlyUpdateItem(session.action(), {
        ...transaction,
        fromBotAccountId: botSession.account.id,
    });

    const history = await expensivelyGetDocumentHistory(session.action(), {id: document.id});

    expect(history.transactions.map(transaction => transaction.author)).toEqual([
        {
            id: session.account.id,
            from: {type: "Bot", accountId: botSession.account.id},
        },
    ]);
    expect(history.accounts.map(account => account.id)).toEqual([botSession.account.id]);
});

test("splits large history transactions into bounded comparison chunks", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);
    const startVersion = await document.getVersion();
    const steps = Array.from(
        {length: 501},
        (_, index) => new DocAttrStep("hasPresentShortcut", index % 2 === 0),
    );

    await document.update(session, steps);
    const endVersion = startVersion + steps.length;

    const history = await expensivelyGetDocumentHistory(session.action(), {id: document.id});

    expect(history.transactions).toMatchObject([
        {startVersion: startVersion + 1, endVersion},
        {startVersion, endVersion: startVersion + 1},
    ]);
});
