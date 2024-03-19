import {addDays} from "date-fns";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    accountAffinitiveSearchEntitiesQueryPageLimit,
    internalGetAffinitiveSearchEntityIds as getAffinitiveSearchEntityIds,
    getAffinitiveSearchEntityIdsEarlyReturnTestCounter,
    getCurrentSearchEntityAccountAffinityPoints,
    getSearchEntityAccountAffinityExpirationDuration,
    getSearchAffinityPointsBucket,
    getSearchEntityTableForTest,
    monthDurationMs,
} from "~/server/search/data/table/search_entity_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {randomFloat} from "~/shared/helpers/number/random_float.js";

const context = createTestContext();

const SearchEntityTable = getSearchEntityTableForTest();

test("buckets search entity account affinity points as expected", () => {
    const cases: Array<[number, number]> = [
        [0, 0],
        [0.05, 0],
        [0.1, 0],
        [0.5, 0],
        [0.99, 0],
        [1, 1],
        [1.05, 1],
        [1.1, 1],
        [1.5, 1],
        [1.99, 1],
        [2, 1],
        [2.05, 1],
        [2.1, 1],
        [2.5, 1],
        [2.99, 1],
        [3, 3],
        [3.05, 3],
        [3.1, 3],
        [3.5, 3],
        [3.99, 3],
        [4, 3],
        [4.05, 3],
        [4.1, 3],
        [4.5, 3],
        [4.99, 3],
        [5, 5],
        [5.05, 5],
        [5.1, 5],
        [5.5, 5],
        [5.99, 5],
        [6, 5],
        [7, 5],
        [8, 5],
        [9, 5],
        [9.05, 5],
        [9.1, 5],
        [9.5, 5],
        [9.99, 5],
        [10, 10],
        [10.05, 10],
        [10.1, 10],
        [10.5, 10],
        [10.99, 10],
        [11, 10],
        [12, 10],
        [13, 10],
        [14, 10],
        [14.05, 10],
        [14.1, 10],
        [14.5, 10],
        [14.99, 10],
        [15, 15],
        [15.05, 15],
        [15.1, 15],
        [15.5, 15],
        [15.99, 15],
        [16, 15],
    ];

    expect(cases.map(([n]) => [n, getSearchAffinityPointsBucket(n)])).toEqual(cases);
});

test("search entity account affinity points decay exponentially", () => {
    const time1 = new Date();
    const time2 = addDays(time1, 30);
    const time3 = addDays(time2, 30);
    const time4 = addDays(time3, 30);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time4.getTime(), {
            points: 1,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.049787068367863944);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time4.getTime(), {
            points: 1,
            lastUpdatedTime: time2.getTime(),
        }),
    ).toEqual(0.1353352832366127);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time4.getTime(), {
            points: 1,
            lastUpdatedTime: time3.getTime(),
        }),
    ).toEqual(0.36787944117144233);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time3.getTime(), {
            points: 0.36787944117144233,
            lastUpdatedTime: time2.getTime(),
        }),
    ).toEqual(0.1353352832366127);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time3.getTime(), {
            points: 0.36787944117144233,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.04978706836786395);

    expect(
        getCurrentSearchEntityAccountAffinityPoints(time2.getTime(), {
            points: 0.1353352832366127,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.04978706836786395);
});

test("can determine when search entity account affinity points will expire", () => {
    const time1 = new Date();
    const time2 = addDays(time1, 30);
    const monthDuration = time2.getTime() - time1.getTime();

    // Reference for the numbers returned below.
    expect(monthDuration * 1).toEqual(2592000000);
    expect(monthDuration * 2).toEqual(5184000000);
    expect(monthDuration * 3).toEqual(7776000000);

    expect(Math.ceil(getSearchEntityAccountAffinityExpirationDuration(1))).toEqual(7764938054);

    expect(
        Math.ceil(getSearchEntityAccountAffinityExpirationDuration(0.36787944117144233)),
    ).toEqual(5172938054);

    expect(Math.ceil(getSearchEntityAccountAffinityExpirationDuration(0.1353352832366127))).toEqual(
        2580938054,
    );
});

test("can't read affinitive items for the wrong space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    await otherSpace.addAccount(session);

    const documentCount = 20;

    const documents = await runAllPromises(
        createArrayWithLength(documentCount, index =>
            TestDocument.create(session, {title: `Document ${index + 1}`}),
        ),
    );

    const otherDocuments = await runAllPromises(
        createArrayWithLength(documentCount, index =>
            TestDocument.create(otherSession, {title: `Document ${index + 1}`}),
        ),
    );

    await ProcessContextModule.waitForTestTasks();

    const currentTime = Date.now();

    await runAllPromises(
        documents.map(async (document, documentIndex) => {
            const points = lerp(19, 0.1, documentIndex / (documentCount - 1));

            await SearchEntityTable.createOrReplaceItem(context, {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session.account.id,
                entityId: `Document:${document.id}`,
                points,
                pointsBucket: getSearchAffinityPointsBucket(points),
                lastUpdatedTime: currentTime,
                lastViewedTime: null,
                expirationTime: new Date(
                    currentTime + getSearchEntityAccountAffinityExpirationDuration(points),
                ),
            });
        }),
    );

    await runAllPromises(
        otherDocuments.map(async (document, documentIndex) => {
            const points1 = lerp(19, 0.1, documentIndex / (documentCount - 1));
            const points2 = lerp(0.1, 19, documentIndex / (documentCount - 1));

            await SearchEntityTable.createOrReplaceItem(context, {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: otherSpace.id,
                accountId: session.account.id,
                entityId: `Document:${document.id}`,
                points: points2,
                pointsBucket: getSearchAffinityPointsBucket(points2),
                lastUpdatedTime: currentTime,
                lastViewedTime: null,
                expirationTime: new Date(
                    currentTime + getSearchEntityAccountAffinityExpirationDuration(points2),
                ),
            });

            await SearchEntityTable.createOrReplaceItem(context, {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: otherSpace.id,
                accountId: otherSession.account.id,
                entityId: `Document:${document.id}`,
                points: points1,
                pointsBucket: getSearchAffinityPointsBucket(points1),
                lastUpdatedTime: currentTime,
                lastViewedTime: null,
                expirationTime: new Date(
                    currentTime + getSearchEntityAccountAffinityExpirationDuration(points1),
                ),
            });
        }),
    );

    await expect(
        getAffinitiveSearchEntityIds(otherSession.action(), {spaceId: space.id, limit: 10}),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        (await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 10})).map(
            ({entityId}) => entityId,
        ),
    ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

    expect(
        (
            await getAffinitiveSearchEntityIds(otherSession.action(), {
                spaceId: otherSpace.id,
                limit: 10,
            })
        ).map(({entityId}) => entityId),
    ).toEqual(otherDocuments.slice(0, 10).map(document => `Document:${document.id}`));

    expect(
        (
            await getAffinitiveSearchEntityIds(session.action(), {
                spaceId: otherSpace.id,
                limit: 10,
            })
        ).map(({entityId}) => entityId),
    ).toEqual(
        [...otherDocuments]
            .reverse()
            .slice(0, 10)
            .map(document => `Document:${document.id}`),
    );
});

test(
    "can read affinitive items when there's a lot of stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getAffinitiveSearchEntityIdsEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(accountAffinitiveSearchEntitiesQueryPageLimit * 4.5);

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                TestDocument.create(session, {title: `Document ${index + 1}`}),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                const expectedPoints = lerp(19, 0.1, documentIndex / (documentCount - 1));

                const lastUpdatedMonthsAgo = randomFloat(0, 1 / 2);
                const actualPoints = expectedPoints * Math.exp(lastUpdatedMonthsAgo);
                const lastUpdatedTime =
                    currentTime - Math.round(lastUpdatedMonthsAgo * monthDurationMs);

                const actualDecayedPoints = getCurrentSearchEntityAccountAffinityPoints(
                    currentTime,
                    {
                        points: actualPoints,
                        lastUpdatedTime,
                    },
                );

                expect(actualDecayedPoints).toBeLessThanOrEqual(expectedPoints + 0.001);
                expect(actualDecayedPoints).toBeGreaterThanOrEqual(expectedPoints - 0.001);

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: space.id,
                    accountId: session.account.id,
                    entityId: `Document:${document.id}`,
                    points: actualPoints,
                    pointsBucket: getSearchAffinityPointsBucket(actualPoints),
                    lastUpdatedTime,
                    lastViewedTime: null,
                    expirationTime: new Date(
                        currentTime +
                            getSearchEntityAccountAffinityExpirationDuration(actualPoints),
                    ),
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 10})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 20})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 30})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);
    },
    // 2min timeout for this test
    1000 * 60 * 2,
);

test(
    "can read affinitive items when there's some stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getAffinitiveSearchEntityIdsEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(accountAffinitiveSearchEntitiesQueryPageLimit * 4.5);

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                TestDocument.create(session, {title: `Document ${index + 1}`}),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                const expectedPoints = lerp(19, 0.1, documentIndex / (documentCount - 1));

                const lastUpdatedMonthsAgo = randomFloat(0, 1 / 15);
                const actualPoints = expectedPoints * Math.exp(lastUpdatedMonthsAgo);
                const lastUpdatedTime =
                    currentTime - Math.round(lastUpdatedMonthsAgo * monthDurationMs);

                const actualDecayedPoints = getCurrentSearchEntityAccountAffinityPoints(
                    currentTime,
                    {
                        points: actualPoints,
                        lastUpdatedTime,
                    },
                );

                expect(actualDecayedPoints).toBeLessThanOrEqual(expectedPoints + 0.001);
                expect(actualDecayedPoints).toBeGreaterThanOrEqual(expectedPoints - 0.001);

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: space.id,
                    accountId: session.account.id,
                    entityId: `Document:${document.id}`,
                    points: actualPoints,
                    pointsBucket: getSearchAffinityPointsBucket(actualPoints),
                    lastUpdatedTime,
                    lastViewedTime: null,
                    expirationTime: new Date(
                        currentTime +
                            getSearchEntityAccountAffinityExpirationDuration(actualPoints),
                    ),
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 10})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 20})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 30})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);
    },
    // 2min timeout for this test
    1000 * 60 * 2,
);

test(
    "can read affinitive items when there's no stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getAffinitiveSearchEntityIdsEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(accountAffinitiveSearchEntitiesQueryPageLimit * 4.5);

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                TestDocument.create(session, {title: `Document ${index + 1}`}),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                const points = lerp(19, 0.1, documentIndex / (documentCount - 1));

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: space.id,
                    accountId: session.account.id,
                    entityId: `Document:${document.id}`,
                    points,
                    pointsBucket: getSearchAffinityPointsBucket(points),
                    lastUpdatedTime: currentTime,
                    lastViewedTime: null,
                    expirationTime: new Date(
                        currentTime + getSearchEntityAccountAffinityExpirationDuration(points),
                    ),
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 10})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 20})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {spaceId: space.id, limit: 30})
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, accountAffinitiveSearchEntitiesQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await getAffinitiveSearchEntityIds(session.action(), {
                    spaceId: space.id,
                    limit: documents.length + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);
    },
    // 2min timeout for this test
    1000 * 60 * 2,
);
