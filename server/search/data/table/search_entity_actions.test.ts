import {addDays} from "date-fns";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSearchEntityTableForTest} from "~/server/search/data/table/internal/search_entity_table.js";
import {
    addSearchAffinityEntityActiveTaskAssigneePoints,
    assignSearchAffinityEntityDerivedAttributes,
    favoriteSearchEntity,
    getCurrentSearchAffinityEntityPoints,
    getPossiblyStaleAccountSearchAffinityEntityIds,
    getSearchAffinitiesEarlyReturnTestCounter,
    getSearchAffinityEntityExpirationDuration,
    getSearchAffinityEntityPointsBucket,
    internalGetSearchAffinityEntities,
    internalGetSearchFavoriteEntities,
    isSearchFavoriteEntity,
    markSearchAffinityCreateDocumentEntityInteraction,
    markSearchAffinityEntityInteraction,
    markSearchAffinityEntityInteractionForAccount,
    moveSearchFavoriteEntity,
    removeSearchAffinityEntityActiveTaskAssigneePoints,
    searchAffinityEntityQueryPageLimit,
    thirtyDaysDurationMs,
    unfavoriteSearchEntity,
} from "~/server/search/data/table/search_entity_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {randomFloat} from "~/shared/helpers/number/random_float.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
});

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

    expect(cases.map(([n]) => [n, getSearchAffinityEntityPointsBucket(n)])).toEqual(cases);
});

test("search entity account affinity points decay exponentially", () => {
    const time1 = new Date();
    const time2 = addDays(time1, 10);
    const time3 = addDays(time2, 10);
    const time4 = addDays(time3, 10);

    expect(
        getCurrentSearchAffinityEntityPoints(time4.getTime(), {
            points: 1,
            erosion: 0,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.049787068367863944);

    expect(
        getCurrentSearchAffinityEntityPoints(time4.getTime(), {
            points: 1,
            erosion: 0,
            lastUpdatedTime: time2.getTime(),
        }),
    ).toEqual(0.1353352832366127);

    expect(
        getCurrentSearchAffinityEntityPoints(time4.getTime(), {
            points: 1,
            erosion: 0,
            lastUpdatedTime: time3.getTime(),
        }),
    ).toEqual(0.36787944117144233);

    expect(
        getCurrentSearchAffinityEntityPoints(time3.getTime(), {
            points: 0.36787944117144233,
            erosion: 0,
            lastUpdatedTime: time2.getTime(),
        }),
    ).toEqual(0.1353352832366127);

    expect(
        getCurrentSearchAffinityEntityPoints(time3.getTime(), {
            points: 0.36787944117144233,
            erosion: 0,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.04978706836786395);

    expect(
        getCurrentSearchAffinityEntityPoints(time2.getTime(), {
            points: 0.1353352832366127,
            erosion: 0,
            lastUpdatedTime: time1.getTime(),
        }),
    ).toEqual(0.04978706836786395);
});

test("can determine when search entity account affinity points will expire", () => {
    const time1 = new Date();
    const time2 = addDays(time1, 30);
    const monthDuration = time2.getTime() - time1.getTime();

    expect(
        getSearchAffinityEntityExpirationDuration({points: 1, erosion: 0}) / monthDuration,
    ).toEqual(0.9985774245179969);

    expect(
        getSearchAffinityEntityExpirationDuration({points: 0.36787944117144233, erosion: 0}) /
            monthDuration,
    ).toEqual(0.6652440911846637);

    expect(
        getSearchAffinityEntityExpirationDuration({points: 0.1353352832366127, erosion: 0}) /
            monthDuration,
    ).toEqual(0.33191075785133034);
});

// This tests the core idea behind `addSearchAffinityActiveTaskAssigneePoints()`
// and `removeSearchAffinityActiveTaskAssigneePoints()` without calling them
// directly. We should be able to add some large point boost when the task becomes
// active then later remove that point boost and it'll be as if we never added the
// point boost in the first place.
test("can increment by some point value and decrement by the decayed point value later", () => {
    const time1 = new Date();
    const time2 = addDays(time1, 10);
    const time3 = addDays(time2, 10);
    const time4 = addDays(time3, 10);

    const points1 = 30;

    const points2a = getCurrentSearchAffinityEntityPoints(time2.getTime(), {
        points: points1,
        erosion: 0,
        lastUpdatedTime: time1.getTime(),
    });

    const points3a = getCurrentSearchAffinityEntityPoints(time3.getTime(), {
        points: points1,
        erosion: 0,
        lastUpdatedTime: time1.getTime(),
    });

    const points4a = getCurrentSearchAffinityEntityPoints(time4.getTime(), {
        points: points1,
        erosion: 0,
        lastUpdatedTime: time1.getTime(),
    });

    expect(points2a).toEqual(11.03638323514327);
    expect(points3a).toEqual(4.060058497098381);
    expect(points4a).toEqual(1.4936120510359183);

    const points2bIncrement = 100;
    const points2b = points2a + points2bIncrement;

    const points3b = getCurrentSearchAffinityEntityPoints(time3.getTime(), {
        points: points2b,
        erosion: 0,
        lastUpdatedTime: time2.getTime(),
    });

    const points4b = getCurrentSearchAffinityEntityPoints(time4.getTime(), {
        points: points2b,
        erosion: 0,
        lastUpdatedTime: time2.getTime(),
    });

    expect(points3b).toEqual(40.84800261424261);
    expect(points4b).toEqual(15.027140374697188);

    const points3cDecrement = getCurrentSearchAffinityEntityPoints(time3.getTime(), {
        points: points2bIncrement,
        erosion: 0,
        lastUpdatedTime: time2.getTime(),
    });

    const points3c = points3b - points3cDecrement;

    expect(points3cDecrement).toEqual(36.787944117144235);
    expect(points3c).toBeCloseTo(points3a, 10);

    // Test that we get the same value calling `getCurrentSearchAffinityPoints()` with
    // already decayed values.
    {
        expect(
            getCurrentSearchAffinityEntityPoints(time3.getTime(), {
                points: points2a,
                erosion: 0,
                lastUpdatedTime: time2.getTime(),
            }),
        ).toBeCloseTo(points3a, 10);

        expect(
            getCurrentSearchAffinityEntityPoints(time4.getTime(), {
                points: points2a,
                erosion: 0,
                lastUpdatedTime: time2.getTime(),
            }),
        ).toBeCloseTo(points4a, 10);

        expect(
            getCurrentSearchAffinityEntityPoints(time4.getTime(), {
                points: points3a,
                erosion: 0,
                lastUpdatedTime: time3.getTime(),
            }),
        ).toBeCloseTo(points4a, 10);

        expect(
            getCurrentSearchAffinityEntityPoints(time4.getTime(), {
                points: points3b,
                erosion: 0,
                lastUpdatedTime: time3.getTime(),
            }),
        ).toBeCloseTo(points4b, 10);
    }
});

test("can figure out the correct expiration duration with erosion", () => {
    const currentTime = new Date();

    for (const erosion of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        for (const points of [1, 10, 60]) {
            for (const days of [0, 1, 2, 3, 7, 14, 30]) {
                const decayedPoints = getCurrentSearchAffinityEntityPoints(
                    addDays(currentTime, days).getTime(),
                    {
                        points,
                        erosion,
                        lastUpdatedTime: currentTime.getTime(),
                    },
                );

                const expirationDuration = getSearchAffinityEntityExpirationDuration({
                    points: decayedPoints,
                    erosion,
                });

                if (decayedPoints <= 0.05) {
                    expect(expirationDuration).toEqual(0);
                } else {
                    expect(
                        getCurrentSearchAffinityEntityPoints(
                            addDays(currentTime, days).getTime() + expirationDuration,
                            {
                                points: decayedPoints,
                                erosion,
                                lastUpdatedTime: addDays(currentTime, days).getTime(),
                            },
                        ),
                    ).toBeCloseTo(0.05, 12);
                }
            }
        }
    }
});

test("can\u2019t read affinitive items for the wrong space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    await otherSpace.addAccount(session);

    const documentCount = 20;

    // Limit concurrent requests to reduce test flakiness.
    const mutexes = createArrayWithLength(5, () => new Mutex());

    const documents = await runAllPromises(
        createArrayWithLength(documentCount, index =>
            mutexes[index % mutexes.length]!.withLock(async () => {
                const document = await TestDocument.create(session, {
                    title: `Document ${index + 1}`,
                });
                await document.access.grantDefault(session);
                return document;
            }),
        ),
    );

    const otherDocuments = await runAllPromises(
        createArrayWithLength(documentCount, index =>
            mutexes[index % mutexes.length]!.withLock(async () => {
                const document = await TestDocument.create(otherSession, {
                    title: `Document ${index + 1}`,
                });
                await document.access.grantDefault(otherSession);
                return document;
            }),
        ),
    );

    await ProcessContextModule.waitForTestTasks();

    const currentTime = Date.now();

    await runAllPromises(
        documents.map(async (document, documentIndex) => {
            await mutexes[documentIndex % mutexes.length]!.withLock(async () => {
                const points = lerp(19, 0.1, documentIndex / (documentCount - 1));

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: space.id,
                    accountId: session.account.id,
                    entityId: `Document:${document.id}`,
                    points,
                    pointsBucket: getSearchAffinityEntityPointsBucket(points),
                    erosion: 0,
                    lastUpdatedTime: currentTime,
                    favoriteOrderKey: null,
                    expirationTime: new Date(
                        currentTime +
                            getSearchAffinityEntityExpirationDuration({points, erosion: 0}),
                    ),
                });
            });
        }),
    );

    await runAllPromises(
        otherDocuments.map(async (document, documentIndex) => {
            await mutexes[documentIndex % mutexes.length]!.withLock(async () => {
                const points1 = lerp(19, 0.1, documentIndex / (documentCount - 1));
                const points2 = lerp(0.1, 19, documentIndex / (documentCount - 1));

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: otherSpace.id,
                    accountId: session.account.id,
                    entityId: `Document:${document.id}`,
                    points: points2,
                    pointsBucket: getSearchAffinityEntityPointsBucket(points2),
                    erosion: 0,
                    lastUpdatedTime: currentTime,
                    favoriteOrderKey: null,
                    expirationTime: new Date(
                        currentTime +
                            getSearchAffinityEntityExpirationDuration({
                                points: points2,
                                erosion: 0,
                            }),
                    ),
                });

                await SearchEntityTable.createOrReplaceItem(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: otherSpace.id,
                    accountId: otherSession.account.id,
                    entityId: `Document:${document.id}`,
                    points: points1,
                    pointsBucket: getSearchAffinityEntityPointsBucket(points1),
                    erosion: 0,
                    lastUpdatedTime: currentTime,
                    favoriteOrderKey: null,
                    expirationTime: new Date(
                        currentTime +
                            getSearchAffinityEntityExpirationDuration({
                                points: points1,
                                erosion: 0,
                            }),
                    ),
                });
            });
        }),
    );

    await expect(
        internalGetSearchAffinityEntities(otherSession.action(), {spaceId: space.id, limit: 10}),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        (
            await internalGetSearchAffinityEntities(session.action(), {
                spaceId: space.id,
                limit: 10,
            })
        ).map(({entityId}) => entityId),
    ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

    expect(
        (
            await internalGetSearchAffinityEntities(otherSession.action(), {
                spaceId: otherSpace.id,
                limit: 10,
            })
        ).map(({entityId}) => entityId),
    ).toEqual(otherDocuments.slice(0, 10).map(document => `Document:${document.id}`));

    expect(
        (
            await internalGetSearchAffinityEntities(session.action(), {
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
    "can read affinitive items when there\u2019s a lot of stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getSearchAffinitiesEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(searchAffinityEntityQueryPageLimit * 4.5);

        // Limit concurrent requests to reduce test flakiness.
        const mutexes = createArrayWithLength(5, () => new Mutex());

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                mutexes[index % mutexes.length]!.withLock(async () => {
                    const document = await TestDocument.create(session, {
                        title: `Document ${index + 1}`,
                    });
                    await document.access.grantDefault(session);

                    // Wait for feed entries to be created otherwise we get "Retry with exponential
                    // backoff" failures because there's a lot of writes trying to update the account's
                    // `FeedAccountCandidates#Attributes` item at once.
                    await ProcessContextModule.waitForTestTasks();

                    return document;
                }),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                await mutexes[documentIndex % mutexes.length]!.withLock(async () => {
                    const expectedPoints = lerp(19, 0.1, documentIndex / (documentCount - 1));

                    const lastUpdatedMonthsAgo = randomFloat(0, 1 / 2);
                    const actualPoints = expectedPoints * Math.exp(3 * lastUpdatedMonthsAgo);
                    const lastUpdatedTime =
                        currentTime - Math.round(lastUpdatedMonthsAgo * thirtyDaysDurationMs);

                    const actualDecayedPoints = getCurrentSearchAffinityEntityPoints(currentTime, {
                        points: actualPoints,
                        erosion: 0,
                        lastUpdatedTime,
                    });

                    expect(actualDecayedPoints).toBeLessThanOrEqual(expectedPoints + 0.001);
                    expect(actualDecayedPoints).toBeGreaterThanOrEqual(expectedPoints - 0.001);

                    await SearchEntityTable.createOrReplaceItem(context, {
                        partitionType: "Account",
                        sortRangeType: "SearchEntityAffinity",
                        spaceId: space.id,
                        accountId: session.account.id,
                        entityId: `Document:${document.id}`,
                        points: actualPoints,
                        pointsBucket: getSearchAffinityEntityPointsBucket(actualPoints),
                        erosion: 0,
                        lastUpdatedTime,
                        favoriteOrderKey: null,
                        expirationTime: new Date(
                            currentTime +
                                getSearchAffinityEntityExpirationDuration({
                                    points: actualPoints,
                                    erosion: 0,
                                }),
                        ),
                    });
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 30,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
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
    "can read affinitive items when there\u2019s some stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getSearchAffinitiesEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(searchAffinityEntityQueryPageLimit * 4.5);

        // Limit concurrent requests to reduce test flakiness.
        const mutexes = createArrayWithLength(5, () => new Mutex());

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                mutexes[index % mutexes.length]!.withLock(async () => {
                    const document = await TestDocument.create(session, {
                        title: `Document ${index + 1}`,
                    });
                    await document.access.grantDefault(session);
                    return document;
                }),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                await mutexes[documentIndex % mutexes.length]!.withLock(async () => {
                    const expectedPoints = lerp(19, 0.1, documentIndex / (documentCount - 1));

                    const lastUpdatedMonthsAgo = randomFloat(0, 1 / 15);
                    const actualPoints = expectedPoints * Math.exp(3 * lastUpdatedMonthsAgo);
                    const lastUpdatedTime =
                        currentTime - Math.round(lastUpdatedMonthsAgo * thirtyDaysDurationMs);

                    const actualDecayedPoints = getCurrentSearchAffinityEntityPoints(currentTime, {
                        points: actualPoints,
                        erosion: 0,
                        lastUpdatedTime,
                    });

                    expect(actualDecayedPoints).toBeLessThanOrEqual(expectedPoints + 0.001);
                    expect(actualDecayedPoints).toBeGreaterThanOrEqual(expectedPoints - 0.001);

                    await SearchEntityTable.createOrReplaceItem(context, {
                        partitionType: "Account",
                        sortRangeType: "SearchEntityAffinity",
                        spaceId: space.id,
                        accountId: session.account.id,
                        entityId: `Document:${document.id}`,
                        points: actualPoints,
                        pointsBucket: getSearchAffinityEntityPointsBucket(actualPoints),
                        erosion: 0,
                        lastUpdatedTime,
                        favoriteOrderKey: null,
                        expirationTime: new Date(
                            currentTime +
                                getSearchAffinityEntityExpirationDuration({
                                    points: actualPoints,
                                    erosion: 0,
                                }),
                        ),
                    });
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 30,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
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
    "can read affinitive items when there\u2019s no stale points",
    async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const {getCount} = getSearchAffinitiesEarlyReturnTestCounter.recordForTest(
            session.account.id,
        );

        const documentCount = Math.floor(searchAffinityEntityQueryPageLimit * 4.5);

        // Limit concurrent requests to reduce test flakiness.
        const mutexes = createArrayWithLength(5, () => new Mutex());

        const documents = await runAllPromises(
            createArrayWithLength(documentCount, index =>
                mutexes[index % mutexes.length]!.withLock(async () => {
                    const document = await TestDocument.create(session, {
                        title: `Document ${index + 1}`,
                    });
                    await document.access.grantDefault(session);
                    return document;
                }),
            ),
        );

        await ProcessContextModule.waitForTestTasks();

        const currentTime = Date.now();

        await runAllPromises(
            documents.map(async (document, documentIndex) => {
                await mutexes[documentIndex % mutexes.length]!.withLock(async () => {
                    const points = lerp(19, 0.1, documentIndex / (documentCount - 1));

                    await SearchEntityTable.createOrReplaceItem(context, {
                        partitionType: "Account",
                        sortRangeType: "SearchEntityAffinity",
                        spaceId: space.id,
                        accountId: session.account.id,
                        entityId: `Document:${document.id}`,
                        points,
                        pointsBucket: getSearchAffinityEntityPointsBucket(points),
                        erosion: 0,
                        lastUpdatedTime: currentTime,
                        favoriteOrderKey: null,
                        expirationTime: new Date(
                            currentTime +
                                getSearchAffinityEntityExpirationDuration({points, erosion: 0}),
                        ),
                    });
                });
            }),
        );

        expect(getCount()).toEqual(0);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 10).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(1);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 20).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(2);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: 30,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.slice(0, 30).map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(3);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(4);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(5);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(6);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(7);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 10,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 10)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(8);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: searchAffinityEntityQueryPageLimit * 2 + 20,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(
            documents
                .slice(0, searchAffinityEntityQueryPageLimit * 2 + 20)
                .map(document => `Document:${document.id}`),
        );

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
                    spaceId: space.id,
                    limit: documents.length,
                })
            ).map(({entityId}) => entityId),
        ).toEqual(documents.map(document => `Document:${document.id}`));

        expect(getCount()).toEqual(9);

        expect(
            (
                await internalGetSearchAffinityEntities(session.action(), {
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

test("can add, remove, and add again search affinity task assignee points", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    const getTaskSearchAffinityPoints = async () => {
        const affinities = await internalGetSearchAffinityEntities(session.action(), {
            spaceId: space.id,
            limit: 10,
        });

        return affinities.find(affinity => affinity.entityId === `Task:${task.id}`)?.points ?? null;
    };

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(150);
});

test("can add, remove, and add again search affinity task assignee points to a task that already has some affinity points", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    const getTaskSearchAffinityPoints = async () => {
        const affinities = await internalGetSearchAffinityEntities(session.action(), {
            spaceId: space.id,
            limit: 10,
        });

        return affinities.find(affinity => affinity.entityId === `Task:${task.id}`)?.points ?? null;
    };

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(1);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(2);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(3);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(3);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(3);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(3);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(153);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(154);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(155);

    await markSearchAffinityEntityInteraction(session.action(), {
        spaceId: space.id,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(156);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(6);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(6);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: session.account.id,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toBeCloseTo(6);
});

test("marking create document interaction adds erosion to affinity item", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    await markSearchAffinityCreateDocumentEntityInteraction(session.action(), {
        spaceId: space.id,
        documentId,
        creatorId: session.account.id,
    });

    expect(
        await SearchEntityTable.getItem(context, {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId: space.id,
            accountId: session.account.id,
            entityId: `Document:${documentId}`,
        }),
    ).toEqual({
        partitionType: "Account",
        sortRangeType: "SearchEntityAffinity",
        spaceId: space.id,
        accountId: session.account.id,
        entityId: `Document:${documentId}`,
        points: 60,
        pointsBucket: getSearchAffinityEntityPointsBucket(60),
        erosion: 10,
        lastUpdatedTime: expect.any(Number),
        favoriteOrderKey: null,
        expirationTime: expect.any(Date),
    });
});

test("can favorite and unfavorite search entities", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([]);

    const document1 = await TestDocument.create(session1);
    await document1.access.grantDefault(session1);
    const document2 = await TestDocument.create(session1);
    await document2.access.grantDefault(session1);
    const document3 = await TestDocument.create(session1);
    await document3.access.grantDefault(session1);

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, false, false]);

    await unfavoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document3.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, false, false]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document3.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document3.id}`,
            orderKey: "a0",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, false, true]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document3.id}`,
            orderKey: "a0",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, false, true]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document3.id}`,
            orderKey: "a0",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a2",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, true]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document3.id}`,
            orderKey: "a0",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a2",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, true]);

    await moveSearchFavoriteEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document2.id}`,
        orderKey: assertOrderKey("a0V"),
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document3.id}`,
            orderKey: "a0",
        },
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, true]);

    await unfavoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document3.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, false]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, false]);

    await unfavoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, true, false]);

    await unfavoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, true, false]);

    await favoriteSearchEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document1.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, false]);

    await moveSearchFavoriteEntity(session2.action(), {
        spaceId: space.id,
        entityId: `Document:${document3.id}`,
        orderKey: assertOrderKey("a4"),
    });

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Document:${document2.id}`,
            orderKey: "a0V",
        },
        {
            entityId: `Document:${document1.id}`,
            orderKey: "a1",
        },
    ]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(session.action(), {
                        spaceId: space.id,
                        entityId: `Document:${document.id}`,
                    }),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, false]);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(
                        context.impersonatedAccountAction(space.id, session.account.id),
                        {
                            spaceId: space.id,
                            entityId: `Document:${document.id}`,
                        },
                    ),
                ),
            ),
        ),
    ).toEqual([false, false, false, true, true, false]);

    const otherSpace = await TestSpace.create(context);
    await otherSpace.addAccount(session1);
    await otherSpace.addAccount(session2);

    expect(
        await runAllPromises(
            [session1, session2].flatMap(session =>
                [document1, document2, document3].flatMap(document =>
                    isSearchFavoriteEntity(
                        context.impersonatedAccountAction(otherSpace.id, session.account.id),
                        {
                            spaceId: space.id,
                            entityId: `Document:${document.id}`,
                        },
                    ),
                ),
            ),
        ),
    ).toEqual([false, false, false, false, false, false]);
});

test("will show top three favorites at the start of affinity list when querying specific entities", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4, session5, session6] =
        await space.createSessions(6);

    const currentTime = Date.now();

    await runAllPromises([
        SearchEntityTable.createOrReplaceItem(
            context,
            assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session1.account.id,
                entityId: `Account:${session2.account.id}`,
                points: 600,
                erosion: 0,
                lastUpdatedTime: currentTime,
                favoriteOrderKey: null,
            }),
        ),
        SearchEntityTable.createOrReplaceItem(
            context,
            assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session1.account.id,
                entityId: `Account:${session3.account.id}`,
                points: 500,
                erosion: 0,
                lastUpdatedTime: currentTime,
                favoriteOrderKey: null,
            }),
        ),
        SearchEntityTable.createOrReplaceItem(
            context,
            assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session1.account.id,
                entityId: `Account:${session4.account.id}`,
                points: 400,
                erosion: 0,
                lastUpdatedTime: currentTime,
                favoriteOrderKey: null,
            }),
        ),
        SearchEntityTable.createOrReplaceItem(
            context,
            assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session1.account.id,
                entityId: `Account:${session5.account.id}`,
                points: 300,
                erosion: 0,
                lastUpdatedTime: currentTime,
                favoriteOrderKey: null,
            }),
        ),
        SearchEntityTable.createOrReplaceItem(
            context,
            assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId: space.id,
                accountId: session1.account.id,
                entityId: `Account:${session6.account.id}`,
                points: 200,
                erosion: 0,
                lastUpdatedTime: currentTime,
                favoriteOrderKey: null,
            }),
        ),
    ]);

    expect(
        await internalGetSearchFavoriteEntities(session2.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([]);

    expect(
        await internalGetSearchAffinityEntities(session1.action(), {spaceId: space.id, limit: 100}),
    ).toEqual([
        {
            entityId: `Account:${session2.account.id}`,
            points: expect.closeTo(600),
            favoriteOrderKey: null,
        },
        {
            entityId: `Account:${session3.account.id}`,
            points: expect.closeTo(500),
            favoriteOrderKey: null,
        },
        {
            entityId: `Account:${session4.account.id}`,
            points: expect.closeTo(400),
            favoriteOrderKey: null,
        },
        {
            entityId: `Account:${session5.account.id}`,
            points: expect.closeTo(300),
            favoriteOrderKey: null,
        },
        {
            entityId: `Account:${session6.account.id}`,
            points: expect.closeTo(200),
            favoriteOrderKey: null,
        },
    ]);

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session2.account.id,
        session3.account.id,
        session4.account.id,
        session5.account.id,
        session6.account.id,
    ]);

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Account:${session6.account.id}`,
    });

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session6.account.id,
        session2.account.id,
        session3.account.id,
        session4.account.id,
        session5.account.id,
    ]);

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Account:${session5.account.id}`,
    });

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session6.account.id,
        session5.account.id,
        session2.account.id,
        session3.account.id,
        session4.account.id,
    ]);

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Account:${session4.account.id}`,
    });

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session6.account.id,
        session5.account.id,
        session4.account.id,
        session2.account.id,
        session3.account.id,
    ]);

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Account:${session3.account.id}`,
    });

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session6.account.id,
        session5.account.id,
        session4.account.id,
        session2.account.id,
        session3.account.id,
    ]);

    await favoriteSearchEntity(session1.action(), {
        spaceId: space.id,
        entityId: `Account:${session2.account.id}`,
    });

    expect(
        await internalGetSearchFavoriteEntities(session1.action(), {
            spaceId: space.id,
            limit: 100,
        }),
    ).toEqual([
        {
            entityId: `Account:${session6.account.id}`,
            orderKey: "a0",
        },
        {
            entityId: `Account:${session5.account.id}`,
            orderKey: "a1",
        },
        {
            entityId: `Account:${session4.account.id}`,
            orderKey: "a2",
        },
        {
            entityId: `Account:${session3.account.id}`,
            orderKey: "a3",
        },
        {
            entityId: `Account:${session2.account.id}`,
            orderKey: "a4",
        },
    ]);

    expect(
        await internalGetSearchAffinityEntities(session1.action(), {spaceId: space.id, limit: 100}),
    ).toEqual([
        {
            entityId: `Account:${session2.account.id}`,
            points: expect.closeTo(600),
            favoriteOrderKey: "a4",
        },
        {
            entityId: `Account:${session3.account.id}`,
            points: expect.closeTo(500),
            favoriteOrderKey: "a3",
        },
        {
            entityId: `Account:${session4.account.id}`,
            points: expect.closeTo(400),
            favoriteOrderKey: "a2",
        },
        {
            entityId: `Account:${session5.account.id}`,
            points: expect.closeTo(300),
            favoriteOrderKey: "a1",
        },
        {
            entityId: `Account:${session6.account.id}`,
            points: expect.closeTo(200),
            favoriteOrderKey: "a0",
        },
    ]);

    expect(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(session1.action(), space.id),
            ({id}) => id,
        ),
    ).toEqual([
        session6.account.id,
        session5.account.id,
        session4.account.id,
        session2.account.id,
        session3.account.id,
    ]);
});

test("adding and removing search affinity points is a noop for bot account", async () => {
    const bot = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {id: botAccountId} = await bot.instantiate(session);

    const task = await TestTask.create(session);

    const getTaskSearchAffinityPoints = async () => {
        const affinities = await internalGetSearchAffinityEntities(
            // HACK: Should be ok to use an impersonated action since all the function
            // calls is `getAccountId()`.
            //
            // @ts-expect-error
            space.impersonatedAction(botAccountId),
            {spaceId: space.id, limit: 10},
        );

        return affinities.find(affinity => affinity.entityId === `Task:${task.id}`)?.points ?? null;
    };

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await markSearchAffinityEntityInteractionForAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: botAccountId,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await markSearchAffinityEntityInteractionForAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: botAccountId,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await markSearchAffinityEntityInteractionForAccount(space.systemAction(), {
        spaceId: space.id,
        accountId: botAccountId,
        entityId: `Task:${task.id}`,
        interaction: {type: "MediumIntentUpdate"},
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await addSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: botAccountId,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);

    await removeSearchAffinityEntityActiveTaskAssigneePoints(space.systemAction(), {
        spaceId: space.id,
        assigneeId: botAccountId,
        taskId: task.id,
    });

    expect(await getTaskSearchAffinityPoints()).toEqual(null);
});

test("bot can add affinity points on behalf of another account via markSearchAffinityCreateDocumentEntityInteraction", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const documentId = generateId<DocumentId>();

    // Bot adds affinity points on behalf of the human account
    await markSearchAffinityCreateDocumentEntityInteraction(botAction, {
        spaceId: space.id,
        documentId,
        creatorId: adminSession.account.id,
    });

    // The affinity points should be attributed to the human account, not the bot
    const entities = await internalGetSearchAffinityEntities(adminSession.action(), {
        spaceId: space.id,
        limit: 10,
    });

    const documentEntity = entities.find(e => e.entityId === `Document:${documentId}`);
    expect(documentEntity).toBeDefined();
});
