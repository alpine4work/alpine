import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {authorizeTaskQueryAccess} from "~/server/tasks/data/authorization/authorize_task_query_access.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlyMap,
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

function testAuthorizeTaskQueryAccess(
    context: ServerActionContext,
    options: {
        spaceId: SpaceId;
        filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
    },
) {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: context.actor.type === "Session" ? context.actor.getAccountId() : null,
        currentDate: toCalendarDate(
            parseAbsolute(new Date(testTaskClock.now()[0]).toISOString(), defaultTimeZone),
        ),
    };

    const filters = options?.filters
        ? isReadonlyArray(options.filters)
            ? normalizeTaskQueryFilters(options.filters, evaluationContext)
            : ({type: "Possible", normalizedFilters: options.filters} as const)
        : normalizeTaskQueryFilters([], evaluationContext);

    if (filters.type === "Impossible") {
        throw new InvalidArgumentError("Impossible filters");
    }

    return authorizeTaskQueryAccess(
        context,
        {
            spaceId: options.spaceId,
            filters: filters.normalizedFilters,
            sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
        },
        {
            getTaskIndexDocIfExists: () => undefined,
            getCollectionIndexDocIfExists: () => undefined,
        },
    );
}

describe("authorizeTaskQueryAccess()", () => {
    test("can\u2019t authorize query with no filters", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {spaceId: space.id}),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("authorizes a query with creator filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
            ],
        });

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with creator filter if account access was removed", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const session = await space.createSession();

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {type: "Creator", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}},
            ],
        });

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        });

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session.account.id,
        });

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });

    test("doesn\u2019t authorize a query that only excludes creator in filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "NoneOf",
                            accounts: [{type: "Account", accountId: session.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can\u2019t authorize a query with other accounts in creator filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [
                                {type: "CurrentAccount"},
                                {type: "Account", accountId: otherSession.account.id},
                            ],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [
                                {type: "Account", accountId: session.account.id},
                                {type: "Account", accountId: otherSession.account.id},
                            ],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("authorizes a query with assignee filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        });

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with assignee filter if account access was removed", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const session = await space.createSession();

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
        });

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "Account", accountId: session.account.id}],
                    },
                },
            ],
        });

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session.account.id,
        });

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });

    test("doesn\u2019t authorize a query that only excludes assignee in filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "NoneOf",
                            accounts: [{type: "Account", accountId: session.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can\u2019t authorize a query with other accounts in assignee filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [
                                {type: "CurrentAccount"},
                                {type: "Account", accountId: otherSession.account.id},
                            ],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [
                                {type: "Account", accountId: session.account.id},
                                {type: "Account", accountId: otherSession.account.id},
                            ],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can\u2019t authorize a query with missing assignee filter", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "MissingAccount"}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}, {type: "MissingAccount"}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [
                                {type: "Account", accountId: session.account.id},
                                {type: "MissingAccount"},
                            ],
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can authorize a query with a collection you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with a collection in a different space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await otherSpace.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await space.addAccount(session2);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: otherSpace.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Task collection is in the wrong space");

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection.id]),
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with a collection you don\u2019t have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can\u2019t authorize an excludes all of query with a collection you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "ExcludesAllOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can\u2019t authorize an is empty collection query", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IsEmpty",
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can authorize a query with one of three collections you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        const collection2 = await TestTaskCollection.create(session1);
        await collection2.access.grantDefault(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection3.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with one of two collections you have access to and one you don\u2019t", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([
                                collection1.id,
                                collection2.id,
                                collection3.id,
                            ]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can authorize a query with all of three collections you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection2.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
            ],
        });
    });

    test("can\u2019t authorize a query with all of two collections you have access to and one you don\u2019t", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesAllOf",
                            collectionIds: new Set([
                                collection1.id,
                                collection2.id,
                                collection3.id,
                            ]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can\u2019t authorize a query with excludes all of three collections you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection2.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "ExcludesAllOf",
                            collectionIds: new Set([
                                collection1.id,
                                collection2.id,
                                collection3.id,
                            ]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );
    });

    test("can\u2019t authorize a query with excludes all of two collections you have access to and one you don\u2019t", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "ExcludesAllOf",
                            collectionIds: new Set([
                                collection1.id,
                                collection2.id,
                                collection3.id,
                            ]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can authorize a query when filtering by a collection you don\u2019t have access to that\u2019s ignored by boolean logic", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id, collection3.id]),
                    },
                },
            ],
        });

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id, collection2.id, collection3.id]),
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection3.id]),
                    },
                },
            ],
        });

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesAllOf",
                            collectionIds: new Set([collection1.id, collection2.id]),
                        },
                    },
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesAllOf",
                            collectionIds: new Set([collection1.id, collection3.id]),
                        },
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can\u2019t authorize is empty collection filter with an accessible collection filter", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    collectionsFilter: [
                        assertNonEmptyReadonlyMap(
                            new Map<TaskCollectionId | "IsEmpty", boolean>([
                                ["IsEmpty", false],
                                [collection.id, false],
                            ]),
                        ),
                    ],
                },
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        // This is an impossible filter which will return no results.
        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                collectionsFilter: [
                    assertNonEmptyReadonlyMap(
                        new Map<TaskCollectionId | "IsEmpty", boolean>([["IsEmpty", false]]),
                    ),
                    assertNonEmptyReadonlyMap(
                        new Map<TaskCollectionId | "IsEmpty", boolean>([[collection.id, false]]),
                    ),
                ],
            },
        });
    });

    test("can authorize a query when filtering by a collection filter merged by boolean logic", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        const collection3 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection2.access.grantDefault(session1);
        await collection3.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection2.id]),
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id, collection3.id]),
                    },
                },
            ],
        });
    });

    test("can authorize an excludes collections query when with a passing filter", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        const collection2 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        await collection2.access.grantDefault(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesAllOf",
                        collectionIds: new Set([collection1.id]),
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "ExcludesAllOf",
                        collectionIds: new Set([collection2.id]),
                    },
                },
            ],
        });

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Collections",
                    operation: {
                        type: "ExcludesAllOf",
                        collectionIds: new Set([collection2.id]),
                    },
                },
            ],
        });
    });

    test("can authorize a query with a parent filter for a task you have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        const task = await TestTask.create(session1);

        await task.addCollection(session1, collection);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        });
    });

    test("can\u2019t authorize a query with a parent filter in a different space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await otherSpace.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        const task = await TestTask.create(session1);

        await task.addCollection(session1, collection);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task.id,
                    },
                },
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await space.addAccount(session2);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: otherSpace.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task.id,
                    },
                },
            }),
        ).rejects.toThrow("Parent task is in the wrong space");

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        });
    });

    test("can\u2019t authorize a query with a parent filter for a task you don\u2019t have access to", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        const task = await TestTask.create(session1);

        await task.addCollection(session1, collection);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task.id,
                    },
                },
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can authorize a query with a parent filter for a task you have access to transitively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        const task1 = await TestTask.create(session1);
        const task2 = await TestTask.create(session1);

        await task1.addCollection(session1, collection);
        await task2.updateParentTask(session1, task1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task2.id,
                },
            },
        });
    });

    test("can\u2019t authorize a query with a parent filter for a task you don\u2019t have access to transitively", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        const task1 = await TestTask.create(session1);
        const task2 = await TestTask.create(session1);

        await task1.addCollection(session1, collection);
        await task2.updateParentTask(session1, task1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task2.id,
                    },
                },
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("can\u2019t authorize a query with a parent filter for a deleted task", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        const task = await TestTask.create(session1);

        await task.addCollection(session1, collection);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        });

        await task.delete(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: {
                    ...defaultTaskQueryNormalizedFilters,
                    parentFilter: {
                        parentTaskId: task.id,
                    },
                },
            }),
        ).rejects.toThrow("Task was deleted");

        await task.undelete(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
        });
    });

    test("must have a parent filter to sort by parent position", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const task = await TestTask.create(session);

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                sorts: [{type: "ParentPosition", direction: "Ascending", missing: "Last"}],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError("Must filter by a parent task to sort by parent position"),
        );

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                parentFilter: {
                    parentTaskId: task.id,
                },
            },
            sorts: [{type: "ParentPosition", direction: "Ascending", missing: "Last"}],
        });
    });

    test("must be allowed to access collection to sort by collection position", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        const collection2 = await TestTaskCollection.create(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                sorts: [
                    {
                        type: "CollectionPosition",
                        collectionId: collection1.id,
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Query may reveal tasks the session account is not allowed to see",
            ),
        );

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection1.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
                sorts: [
                    {
                        type: "CollectionPosition",
                        collectionId: collection2.id,
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("collection must be in the right space to sort by collection position", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await otherSpace.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: otherSpace.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
                sorts: [
                    {
                        type: "CollectionPosition",
                        collectionId: collection1.id,
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await space.addAccount(session2);

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: otherSpace.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
                sorts: [
                    {
                        type: "CollectionPosition",
                        collectionId: collection1.id,
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow("Task collection is in the wrong space");

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
            ],
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection1.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });
    });

    test("must be allowed to access collection to sort by collection position with collection filter", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const collection1 = await TestTaskCollection.create(session1);
        await collection1.access.grantDefault(session1);
        const collection2 = await TestTaskCollection.create(session1);

        await testAuthorizeTaskQueryAccess(session2.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collection1.id]),
                    },
                },
            ],
            sorts: [
                {
                    type: "CollectionPosition",
                    collectionId: collection1.id,
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection1.id]),
                        },
                    },
                ],
                sorts: [
                    {
                        type: "CollectionPosition",
                        collectionId: collection2.id,
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow(new PermissionDeniedError("Actor doesn\u2019t have `View` access level"));
    });

    test("must filter by assignee to sort by assignee position", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const adminSession = await space.createSession({role: "Admin"});

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                sorts: [
                    {
                        type: "AssigneePosition",
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Must filter assignee to session account to sort by assignee position",
            ),
        );

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
            sorts: [
                {
                    type: "AssigneePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Creator",
                        operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                    },
                ],
                sorts: [
                    {
                        type: "AssigneePosition",
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Must filter assignee to session account to sort by assignee position",
            ),
        );

        await testAuthorizeTaskQueryAccess(session.action(), {
            spaceId: space.id,
            filters: [
                {
                    type: "Creator",
                    operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]},
                },
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ],
            sorts: [
                {
                    type: "AssigneePosition",
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
        });

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session.account.id,
        });

        await expect(
            testAuthorizeTaskQueryAccess(session.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "CurrentAccount"}],
                        },
                    },
                ],
                sorts: [
                    {
                        type: "AssigneePosition",
                        direction: "Ascending",
                        missing: "Last",
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });

    test("must have space access to filter by creator", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const adminSession = await space.createSession({role: "Admin"});

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});
        await otherSpace.addAccount(session1.account);

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantUrl(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Creator",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Unauthenticated session");

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session1.account.id}],
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "Creator",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session1.account.id}],
                            },
                        },
                    ],
                },
            ),
        ).rejects.toThrow("Impersonated account actor doesn\u2019t have access to space");
    });

    test("must have space access to filter by assigner", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const adminSession = await space.createSession({role: "Admin"});

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});
        await otherSpace.addAccount(session1.account);

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantUrl(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(space.id, otherSession.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                    {
                        type: "Assigner",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: session1.account.id}],
                        },
                    },
                ],
            }),
        ).rejects.toThrow("Unauthenticated session");

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "Assigner",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session1.account.id}],
                            },
                        },
                    ],
                },
            ),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                {
                    spaceId: space.id,
                    filters: [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([collection.id]),
                            },
                        },
                        {
                            type: "Assigner",
                            operation: {
                                type: "OneOf",
                                accounts: [{type: "Account", accountId: session1.account.id}],
                            },
                        },
                    ],
                },
            ),
        ).rejects.toThrow("Impersonated account actor doesn\u2019t have access to space");
    });

    test("must have space access to sort by creator", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const adminSession = await space.createSession({role: "Admin"});

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});
        await otherSpace.addAccount(session1.account);

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantUrl(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Creator"}],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Creator"}],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Creator"}],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Creator"}],
            }),
        ).rejects.toThrow("Unauthenticated session");
    });

    test("must have space access to sort by assigner", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const adminSession = await space.createSession({role: "Admin"});

        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});
        await otherSpace.addAccount(session1.account);

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantUrl(session1);

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session1.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
            }),
        ).resolves.toBeUndefined();

        await expect(
            testAuthorizeTaskQueryAccess(session2.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(otherSession.action(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");

        await expect(
            testAuthorizeTaskQueryAccess(context.anonymousAction(), {
                spaceId: space.id,
                filters: [
                    {
                        type: "Collections",
                        operation: {
                            type: "IncludesOneOf",
                            collectionIds: new Set([collection.id]),
                        },
                    },
                ],
                sorts: [{type: "Assigner", direction: "Ascending", missing: "Last"}],
            }),
        ).rejects.toThrow("Unauthenticated session");
    });
});
