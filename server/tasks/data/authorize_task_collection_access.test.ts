import {ServerActionContext} from "~/server/context/server_action_context.js";
import {captureAfterTestEndsCallbacks} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    authorizeTaskCollectionAccess,
    authorizeTaskCollectionAccessIfPossible,
} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {NotFoundError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

let scenario: Awaited<ReturnType<typeof createScenario>>;
let runAfterTestEndsCallbacks: () => Promise<void>;

beforeAll(async () => {
    runAfterTestEndsCallbacks = await captureAfterTestEndsCallbacks(async () => {
        scenario = await createScenario();
    });
});

afterAll(async () => {
    await runAfterTestEndsCallbacks();
});

async function createScenario() {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    await otherSpace.addAccount(session1);

    const [
        publicCollection,
        publicDeletedCollection,
        privateCollection,
        privateDeletedCollection,
        urlPublicCollection,
        urlPublicDeletedCollection,
    ] = await runAllPromises([
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
    ]);

    await publicCollection.access.grantDefault(session1);
    await publicDeletedCollection.access.grantDefault(session1);

    await privateCollection.access.grant(session1, session2, "Comment");
    await privateDeletedCollection.access.grant(session1, session2, "Comment");

    await urlPublicCollection.access.grantUrl(session1);
    await urlPublicDeletedCollection.access.grantUrl(session1);

    await publicDeletedCollection.delete(session1);
    await privateDeletedCollection.delete(session1);
    await urlPublicDeletedCollection.delete(session1);

    return {
        space,
        session1,
        session2,
        session3,
        otherSpace,
        otherSession,
        publicCollection,
        publicDeletedCollection,
        privateCollection,
        privateDeletedCollection,
        urlPublicCollection,
        urlPublicDeletedCollection,
    };
}

type ExpectedResult = string | null;

type SessionName = "session1" | "session2" | "session3" | "otherSession";

type CollectionName =
    | "publicCollection"
    | "publicDeletedCollection"
    | "privateCollection"
    | "privateDeletedCollection"
    | "urlPublicCollection"
    | "urlPublicDeletedCollection";

const testCases: Record<
    CollectionName,
    Record<
        "View" | "Comment" | "Edit",
        {
            anonymous: ExpectedResult;
            system: {
                space: ExpectedResult;
                otherSpace: ExpectedResult;
            };
            session: Record<SessionName, ExpectedResult>;
            impersonatedAccount: {
                space: Record<"session1" | "session2" | "session3", ExpectedResult>;
                otherSpace: Record<"session1" | "otherSession", ExpectedResult>;
            };
        }
    >
> = {
    publicCollection: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: null,
                session3: null,
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: null,
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: null,
                session3: null,
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: null,
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: null,
                session3: null,
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: null,
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
    },
    publicDeletedCollection: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
    },
    privateCollection: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: null,
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: null,
                session3: "Actor doesn\u2019t have `Comment` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: "Actor doesn\u2019t have `Comment` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: "Actor doesn\u2019t have `Edit` access level",
                session3: "Actor doesn\u2019t have `Edit` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: "Actor doesn\u2019t have `Edit` access level",
                    session3: "Actor doesn\u2019t have `Edit` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
    },
    privateDeletedCollection: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task collection was deleted",
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
    },
    urlPublicCollection: {
        View: {
            anonymous: null,
            system: {
                space: null,
                otherSpace: null,
            },
            session: {
                session1: null,
                session2: null,
                session3: null,
                otherSession: null,
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: null,
                    session3: null,
                },
                otherSpace: {
                    session1: null,
                    otherSession: null,
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: "Actor doesn\u2019t have `Comment` access level",
                session3: "Actor doesn\u2019t have `Comment` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: "Actor doesn\u2019t have `Comment` access level",
                    session3: "Actor doesn\u2019t have `Comment` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to space",
            },
            session: {
                session1: null,
                session2: "Actor doesn\u2019t have `Edit` access level",
                session3: "Actor doesn\u2019t have `Edit` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: "Actor doesn\u2019t have `Edit` access level",
                    session3: "Actor doesn\u2019t have `Edit` access level",
                },
                otherSpace: {
                    session1: "Impersonated account actor doesn\u2019t have access to space",
                    otherSession: "Impersonated account actor doesn\u2019t have access to space",
                },
            },
        },
    },
    urlPublicDeletedCollection: {
        View: {
            anonymous: "Task collection was deleted",
            system: {
                space: "Task collection was deleted",
                otherSpace: "Task collection was deleted",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Task collection was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Task collection was deleted",
                    otherSession: "Task collection was deleted",
                },
            },
        },
        Comment: {
            anonymous: "Task collection was deleted",
            system: {
                space: "Task collection was deleted",
                otherSpace: "Task collection was deleted",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Task collection was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Task collection was deleted",
                    otherSession: "Task collection was deleted",
                },
            },
        },
        Edit: {
            anonymous: "Task collection was deleted",
            system: {
                space: "Task collection was deleted",
                otherSpace: "Task collection was deleted",
            },
            session: {
                session1: "Task collection was deleted",
                session2: "Task collection was deleted",
                session3: "Task collection was deleted",
                otherSession: "Task collection was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task collection was deleted",
                    session2: "Task collection was deleted",
                    session3: "Task collection was deleted",
                },
                otherSpace: {
                    session1: "Task collection was deleted",
                    otherSession: "Task collection was deleted",
                },
            },
        },
    },
};

async function runTest(
    context: ServerActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: "View" | "Comment" | "Edit",
) {
    const result = await authorizeTaskCollectionAccessIfPossible(
        context,
        collectionId,
        expectedAccessLevel,
    );

    try {
        await authorizeTaskCollectionAccess(context, collectionId, expectedAccessLevel);
        expect(result?.ok).toEqual(true);
        return null;
    } catch (error) {
        if (
            error instanceof PermissionDeniedError ||
            error instanceof UnauthenticatedError ||
            error instanceof NotFoundError
        ) {
            expect(result?.ok).toEqual(false);
            expect(result?.error).toEqual(error);
            return error.message;
        } else {
            throw error;
        }
    }
}

for (const [collectionName, testCases1] of getObjectEntriesWithKeyofType(testCases)) {
    for (const [accessLevel, testCases2] of getObjectEntriesWithKeyofType(testCases1)) {
        {
            const expectedResult = testCases2.anonymous;

            test(
                // eslint-disable-next-line jest/valid-title
                quote`${collectionName} authorized for ${accessLevel} by anonymous actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            context.anonymousAction(),
                            scenario[collectionName].id,
                            accessLevel,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }

        for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
            testCases2.session,
        )) {
            test(
                // eslint-disable-next-line jest/valid-title
                quote`${collectionName} authorized for ${accessLevel} by ${sessionName} session actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            scenario[sessionName].action(),
                            scenario[collectionName].id,
                            accessLevel,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }

        for (const [spaceName, expectedResult] of getObjectEntriesWithKeyofType(
            testCases2.system,
        )) {
            test(
                // eslint-disable-next-line jest/valid-title
                quote`${collectionName} authorized for ${accessLevel} by ${spaceName} system actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            scenario[spaceName].systemAction(),
                            scenario[collectionName].id,
                            accessLevel,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }

        for (const [spaceName, testCases3] of getObjectEntriesWithKeyofType(
            testCases2.impersonatedAccount,
        )) {
            for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(testCases3)) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${collectionName} authorized for ${accessLevel} by ${sessionName} in ${spaceName} impersonated account actor ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[spaceName].impersonatedAction(scenario[sessionName]),
                                scenario[collectionName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }
        }
    }
}
