import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {captureAfterTestEndsCallbacks} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    authorizeTaskAccess,
    authorizeTaskAccessIfPossible,
} from "~/server/tasks/data/task_table.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {NotFoundError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TaskId} from "~/shared/id/types/id_types.js";

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
    const session1 = await space.createSession({role: "Admin"});
    const [session2, session3] = await space.createSessions(3);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});

    await otherSpace.addAccount(session1);

    const bot = await TestBot.createAndInstantiate(session1);
    const otherBot = await TestBot.createAndInstantiate(otherSession);

    const [
        publicCollection,
        publicDeletedCollection,
        privateCollection,
        privateDeletedCollection,
        urlPublicCollection,
        urlPublicDeletedCollection,
        publicTask,
        publicDeletedTask,
        privateTask,
        privateDeletedTask,
        urlPublicTask,
        urlPublicDeletedTask,
        personalTask,
        personalDeletedTask,
    ] = await runAllPromises([
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTaskCollection.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session1),
    ]);

    await publicCollection.access.grantDefault(session1);
    await publicDeletedCollection.access.grantDefault(session1);

    await privateCollection.access.grant(session1, session2, "Comment");
    await privateDeletedCollection.access.grant(session1, session2, "Comment");

    await urlPublicCollection.access.grantUrl(session1);
    await urlPublicDeletedCollection.access.grantUrl(session1);

    await publicTask.addCollection(session1, publicCollection);
    await publicDeletedTask.addCollection(session1, publicDeletedCollection);
    await privateTask.addCollection(session1, privateCollection);
    await privateDeletedTask.addCollection(session1, privateDeletedCollection);
    await urlPublicTask.addCollection(session1, urlPublicCollection);
    await urlPublicDeletedTask.addCollection(session1, urlPublicDeletedCollection);

    await publicDeletedTask.delete(session1);
    await privateDeletedTask.delete(session1);
    await urlPublicDeletedTask.delete(session1);
    await personalDeletedTask.delete(session1);

    return {
        space,
        session1,
        session2,
        session3,
        otherSpace,
        otherSession,
        bot,
        otherBot,
        publicCollection,
        publicDeletedCollection,
        privateCollection,
        privateDeletedCollection,
        urlPublicCollection,
        urlPublicDeletedCollection,
        publicTask,
        publicDeletedTask,
        privateTask,
        privateDeletedTask,
        urlPublicTask,
        urlPublicDeletedTask,
        personalTask,
        personalDeletedTask,
    };
}

type ExpectedResult = string | null;

type SessionName = "session1" | "session2" | "session3" | "otherSession";

type TaskName =
    | "publicTask"
    | "publicDeletedTask"
    | "privateTask"
    | "privateDeletedTask"
    | "urlPublicTask"
    | "urlPublicDeletedTask"
    | "personalTask"
    | "personalDeletedTask";

const testCases: Record<
    TaskName,
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
            bot: {
                bot: {
                    session: Record<"session1" | "session2" | "session3", ExpectedResult>;
                    task: Record<TaskName, ExpectedResult>;
                };
                otherBot: {
                    session: Record<"session1" | "otherSession", ExpectedResult>;
                    task: {};
                };
            };
        }
    >
> = {
    publicTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    task: {
                        publicTask: null,
                        publicDeletedTask: null,
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    task: {
                        publicTask: null,
                        publicDeletedTask: null,
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    task: {
                        publicTask: null,
                        publicDeletedTask: null,
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    publicDeletedTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    privateTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: "Actor doesn\u2019t have `Comment` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Comment` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `Edit` access level",
                        session3: "Actor doesn\u2019t have `Edit` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Edit` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        privateTask: "Actor doesn\u2019t have `Edit` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    privateDeletedTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    urlPublicTask: {
        View: {
            anonymous: null,
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: null,
                        session3: null,
                    },
                    task: {
                        publicTask: null,
                        publicDeletedTask: null,
                        privateTask: null,
                        privateDeletedTask: null,
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: null,
                        otherSession: null,
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `Comment` access level",
                        session3: "Actor doesn\u2019t have `Comment` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Comment` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
                        privateTask: "Actor doesn\u2019t have `Comment` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `Comment` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `Edit` access level",
                        session3: "Actor doesn\u2019t have `Edit` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Edit` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        privateTask: "Actor doesn\u2019t have `Edit` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    urlPublicDeletedTask: {
        View: {
            anonymous: "Task was deleted",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Task was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Task was deleted",
                        otherSession: "Task was deleted",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Task was deleted",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Task was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Task was deleted",
                        otherSession: "Task was deleted",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Task was deleted",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Task was deleted",
                session3: "Task was deleted",
                otherSession: "Task was deleted",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Task was deleted",
                    session3: "Task was deleted",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Task was deleted",
                        session3: "Task was deleted",
                    },
                    task: {
                        publicTask: "Task was deleted",
                        publicDeletedTask: "Task was deleted",
                        privateTask: "Task was deleted",
                        privateDeletedTask: "Task was deleted",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Task was deleted",
                        otherSession: "Task was deleted",
                    },
                    task: {},
                },
            },
        },
    },
    personalTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: null,
                session2: "Actor doesn\u2019t have `View` access level",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: null,
                    session2: "Actor doesn\u2019t have `View` access level",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `View` access level",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Actor doesn\u2019t have `View` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `Comment` access level",
                        session3: "Actor doesn\u2019t have `Comment` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Comment` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
                        privateTask: "Actor doesn\u2019t have `Comment` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `Comment` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: null,
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
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
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: null,
                        session2: "Actor doesn\u2019t have `Edit` access level",
                        session3: "Actor doesn\u2019t have `Edit` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `Edit` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        privateTask: "Actor doesn\u2019t have `Edit` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicTask: null,
                        urlPublicDeletedTask: null,
                        personalTask: null,
                        personalDeletedTask: null,
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
    personalDeletedTask: {
        View: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Actor doesn\u2019t have `View` access level",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Actor doesn\u2019t have `View` access level",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Actor doesn\u2019t have `View` access level",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Actor doesn\u2019t have `View` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Comment: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Actor doesn\u2019t have `View` access level",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Actor doesn\u2019t have `View` access level",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Actor doesn\u2019t have `View` access level",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Actor doesn\u2019t have `View` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
        Edit: {
            anonymous: "Unauthenticated session",
            system: {
                space: "Task was deleted",
                otherSpace: "System actor doesn\u2019t have access to task\u2019s space",
            },
            session: {
                session1: "Task was deleted",
                session2: "Actor doesn\u2019t have `View` access level",
                session3: "Actor doesn\u2019t have `View` access level",
                otherSession: "Account doesn\u2019t have access to space",
            },
            impersonatedAccount: {
                space: {
                    session1: "Task was deleted",
                    session2: "Actor doesn\u2019t have `View` access level",
                    session3: "Actor doesn\u2019t have `View` access level",
                },
                otherSpace: {
                    session1:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                    otherSession:
                        "Impersonated account actor doesn\u2019t have access to task\u2019s space",
                },
            },
            bot: {
                bot: {
                    session: {
                        session1: "Task was deleted",
                        session2: "Actor doesn\u2019t have `View` access level",
                        session3: "Actor doesn\u2019t have `View` access level",
                    },
                    task: {
                        publicTask: "Actor doesn\u2019t have `View` access level",
                        publicDeletedTask: "Actor doesn\u2019t have `View` access level",
                        privateTask: "Actor doesn\u2019t have `View` access level",
                        privateDeletedTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicTask: "Task was deleted",
                        urlPublicDeletedTask: "Task was deleted",
                        personalTask: "Task was deleted",
                        personalDeletedTask: "Task was deleted",
                    },
                },
                otherBot: {
                    session: {
                        session1: "Account doesn\u2019t have access to space",
                        otherSession: "Account doesn\u2019t have access to space",
                    },
                    task: {},
                },
            },
        },
    },
};

async function runTest(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: "View" | "Comment" | "Edit",
) {
    const result = await authorizeTaskAccessIfPossible(context, taskId, expectedAccessLevel);

    try {
        await authorizeTaskAccess(context, taskId, expectedAccessLevel);
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

for (const [taskName, testCases1] of getObjectEntriesWithKeyofType(testCases)) {
    for (const [accessLevel, testCases2] of getObjectEntriesWithKeyofType(testCases1)) {
        {
            const expectedResult = testCases2.anonymous;

            test(
                // eslint-disable-next-line jest/valid-title
                quote`${taskName} authorized for ${accessLevel} by anonymous actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            context.anonymousAction(),
                            scenario[taskName].id,
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
                quote`${taskName} authorized for ${accessLevel} by ${sessionName} session actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            scenario[sessionName].action(),
                            scenario[taskName].id,
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
                quote`${taskName} authorized for ${accessLevel} by ${spaceName} system actor ` +
                    (expectedResult === null ? "is ok" : "throws"),
                async () => {
                    expect(
                        await runTest(
                            scenario[spaceName].systemAction(),
                            scenario[taskName].id,
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
                    quote`${taskName} authorized for ${accessLevel} by ${sessionName} in ${spaceName} impersonated account actor ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[spaceName].impersonatedAction(scenario[sessionName]),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }
        }

        for (const [botName, testCases3] of getObjectEntriesWithKeyofType(testCases2.bot)) {
            for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases3.session,
            )) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${taskName} authorized for ${accessLevel} by ${botName} bot actor with ${sessionName} scope ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[botName].action({
                                    type: "Account",
                                    accountId: scenario[sessionName].account.id,
                                }),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }

            for (const [otherTaskName, expectedResult] of getObjectEntriesWithKeyofType(
                testCases3.task,
            )) {
                test(
                    // eslint-disable-next-line jest/valid-title
                    quote`${taskName} authorized for ${accessLevel} by ${botName} bot actor with ${otherTaskName} scope ` +
                        (expectedResult === null ? "is ok" : "throws"),
                    async () => {
                        expect(
                            await runTest(
                                scenario[botName].action({
                                    type: "Task",
                                    taskId: scenario[otherTaskName].id,
                                }),
                                scenario[taskName].id,
                                accessLevel,
                            ),
                        ).toEqual(expectedResult);
                    },
                );
            }
        }
    }
}
