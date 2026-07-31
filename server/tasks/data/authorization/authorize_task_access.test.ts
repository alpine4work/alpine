import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {captureAfterTestEndsCallbacks} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {authorizeTaskAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_access_if_possible.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {getTaskNotificationSubscribers} from "~/server/tasks/data/get_task_notification_subscribers.js";
import {
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
    getTaskNotesContentAndOptionalInitialCommentsIfExists,
} from "~/server/tasks/data/task_messaging.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
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

// Expected outcomes for `authorizeTaskAccess` across every (target task, requested
// access level, actor) combination.
//
// The outer keys describe the _target_ — the task being accessed and the access
// level requested for it:
//
// - `TaskName`: which task the actor is trying to access (e.g. `privateTask`).
// - `"View" | "Comment" | "Edit"`: the access level being requested.
//
// The inner keys describe the _actor_ attempting the access, grouped by actor
// type. For bot actors specifically, the keys under `bot.{bot,otherBot}.task`
// describe the bot's _scope_ (the task the bot is scoped to), not another target
// task. So `privateTask.View.bot.bot.task.urlPublicTask` reads as: "when `bot` is
// scoped to `urlPublicTask` and tries to `View` `privateTask`".
//
// Each leaf value is either `null` (access is allowed) or the expected error
// message (access is denied with that message).
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Comment` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Comment` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Comment` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Comment` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `Edit` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `Edit` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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
                        urlPublicTask: "Actor doesn\u2019t have `View` access level",
                        urlPublicDeletedTask: "Actor doesn\u2019t have `View` access level",
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

describe("authorizeTaskAccess()", () => {
    test("can authorize task with system actor and anonymous actor and impersonated account actor", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        await otherSpace.addAccount(session1);

        const [task1, collection1] = await runAllPromises([
            TestTask.create(session2),
            TestTaskCollection.create(session2),
        ]);

        await collection1.access.grantDefault(session2);

        await task1.addCollection(session2, collection1);

        await authorizeTaskAccess(session1.action(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await expect(
            authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit"),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
            (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit"),
        ).rejects.toThrow(UnauthenticatedError);
        expect(
            (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await authorizeTaskAccess(
            context.impersonatedAccountAction(space.id, session1.account.id),
            task1.id,
            "Edit",
        );
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(space.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(true);

        await expect(
            authorizeTaskAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            ),
        ).rejects.toThrow(
            "Impersonated account actor doesn\u2019t have access to task\u2019s space",
        );
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(false);

        await commitTaskActionTransaction(session1.action(), space.id, [
            {
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: task1.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection1.id,
                },
            },
        ]);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await expect(
            authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit"),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
            (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit"),
        ).rejects.toThrow(UnauthenticatedError);
        expect(
            (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                task1.id,
                "Edit",
            ),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(space.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            ),
        ).rejects.toThrow(
            "Impersonated account actor doesn\u2019t have access to task\u2019s space",
        );
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(false);

        await expect(
            commitTaskActionTransaction(session1.action(), space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: task1.id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collection1.id,
                        orderKey: initialOrderKey,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await authorizeTaskAccess(space.systemAction(), task1.id, "Edit");
        expect(
            (await authorizeTaskAccessIfPossible(space.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        await expect(
            authorizeTaskAccess(otherSpace.systemAction(), task1.id, "Edit"),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
            (await authorizeTaskAccessIfPossible(otherSpace.systemAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(context.anonymousAction(), task1.id, "Edit"),
        ).rejects.toThrow(UnauthenticatedError);
        expect(
            (await authorizeTaskAccessIfPossible(context.anonymousAction(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(
                context.impersonatedAccountAction(space.id, session1.account.id),
                task1.id,
                "Edit",
            ),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(space.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(false);

        await expect(
            authorizeTaskAccess(
                context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                task1.id,
                "Edit",
            ),
        ).rejects.toThrow(
            "Impersonated account actor doesn\u2019t have access to task\u2019s space",
        );
        expect(
            (
                await authorizeTaskAccessIfPossible(
                    context.impersonatedAccountAction(otherSpace.id, session1.account.id),
                    task1.id,
                    "Edit",
                )
            )?.ok,
        ).toEqual(false);
    });

    test("authorizing task access as session actor is cached", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = session2.action();

            expect(getCount()).toEqual(0);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "Edit");

            expect(getCount()).toEqual(3);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "Edit"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(3);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = session2.action();

            expect(getCount()).toEqual(0);

            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);
        }
    });

    test("authorizing task access as system actor is cached", async () => {
        const space = await TestSpace.create(context);
        const [session1] = await space.createSessions(2);

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = space.systemAction();

            expect(getCount()).toEqual(0);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "Edit");

            expect(getCount()).toEqual(1);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "Edit"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = space.systemAction();

            expect(getCount()).toEqual(0);

            await runAllPromises([
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccess(actionContext, task.id, "View"),
                authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
            ]);

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);
        }
    });

    test("authorizing task access after getting task as session actor is cached", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = session2.action();

            expect(getCount()).toEqual(0);

            await getTaskNotesContentAndOptionalInitialCommentsIfExists(actionContext, {
                taskId: task.id,
                commentsLimit: 100,
            });

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(3);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = session2.action();

            expect(getCount()).toEqual(0);

            await getTaskCommentsFromStart(actionContext, {
                taskId: task.id,
                limit: 100,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            });

            expect(getCount()).toEqual(4);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(4);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(4);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(4);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = session2.action();

            expect(getCount()).toEqual(0);

            await getTaskCommentsFromEnd(actionContext, {
                taskId: task.id,
                limit: 100,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            });

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(3);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(3);
        }
    });

    test("authorizing task access after getting task as system actor is cached", async () => {
        const space = await TestSpace.create(context);
        const [session1] = await space.createSessions(2);

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);
        await task.addCollection(session1, collection);

        await ProcessContextModule.waitForTestTasks();

        const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = space.systemAction();

            expect(getCount()).toEqual(0);

            await getTaskNotificationSubscribers(actionContext, task.id);

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(1);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = space.systemAction();

            expect(getCount()).toEqual(0);

            await getTaskCommentsFromStart(actionContext, {
                taskId: task.id,
                limit: 100,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            });

            expect(getCount()).toEqual(2);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(2);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(2);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(2);
        }

        dynamoClientExecuteActionTestCounter.resetForTest();

        {
            const actionContext = space.systemAction();

            expect(getCount()).toEqual(0);

            await getTaskCommentsFromEnd(actionContext, {
                taskId: task.id,
                limit: 100,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            });

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);

            await authorizeTaskAccess(actionContext, task.id, "View");

            expect(getCount()).toEqual(1);

            for (let i = 0; i < 5; i++) {
                await runAllPromises([
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccess(actionContext, task.id, "View"),
                    authorizeTaskAccessIfPossible(actionContext, task.id, "View"),
                ]);
            }

            expect(getCount()).toEqual(1);
        }
    });

    test("account has access to tasks they create and tasks they\u2019re assigned until they\u2019re removed from the space", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const [session1, session2] = await space.createSessions(2);

        const task1 = await TestTask.create(session1);

        const task2 = await TestTask.create(session2);
        await task2.updateAssignee(session2, session1);

        await expect(
            authorizeTaskAccess(session1.action(), task1.id, "View"),
        ).resolves.not.toThrow();

        await expect(
            authorizeTaskAccess(session1.action(), task2.id, "View"),
        ).resolves.not.toThrow();

        await expect(
            authorizeTaskAccess(session1.action(), task1.id, "Comment"),
        ).resolves.not.toThrow();

        await expect(
            authorizeTaskAccess(session1.action(), task2.id, "Comment"),
        ).resolves.not.toThrow();

        await expect(
            authorizeTaskAccess(session1.action(), task1.id, "Edit"),
        ).resolves.not.toThrow();

        await expect(
            authorizeTaskAccess(session1.action(), task2.id, "Edit"),
        ).resolves.not.toThrow();

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "View"))?.ok,
        ).toEqual(true);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "View"))?.ok,
        ).toEqual(true);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Comment"))?.ok,
        ).toEqual(true);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Comment"))?.ok,
        ).toEqual(true);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(true);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Edit"))?.ok,
        ).toEqual(true);

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session1.account.id,
        });

        await expect(authorizeTaskAccess(session1.action(), task1.id, "View")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        await expect(authorizeTaskAccess(session1.action(), task2.id, "View")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Comment")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        await expect(authorizeTaskAccess(session1.action(), task2.id, "Comment")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        await expect(authorizeTaskAccess(session1.action(), task1.id, "Edit")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        await expect(authorizeTaskAccess(session1.action(), task2.id, "Edit")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "View"))?.ok,
        ).toEqual(false);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "View"))?.ok,
        ).toEqual(false);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Comment"))?.ok,
        ).toEqual(false);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Comment"))?.ok,
        ).toEqual(false);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task1.id, "Edit"))?.ok,
        ).toEqual(false);

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), task2.id, "Edit"))?.ok,
        ).toEqual(false);
    });

    test("account has access to task shared via access policy", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await expect(authorizeTaskAccess(session2.action(), task.id, "View")).rejects.toThrow(
            PermissionDeniedError,
        );
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(false);

        await task.access.grant(session1, session2, "View");

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(true);

        await expect(authorizeTaskAccess(session2.action(), task.id, "Edit")).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("access policy doesn\u2019t grant access after account removed from space", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.access.grant(session1, session2, "View");

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();

        await removeSpaceAccount(adminSession.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        await expect(authorizeTaskAccess(session2.action(), task.id, "View")).rejects.toThrow(
            "Account doesn\u2019t have access to space",
        );

        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(false);
    });

    test("access policy grants access even without collection access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);
        const collection = await TestTaskCollection.create(session1);

        await task.addCollection(session1, collection);

        await expect(authorizeTaskAccess(session2.action(), task.id, "View")).rejects.toThrow(
            PermissionDeniedError,
        );

        await task.access.grant(session1, session2, "View");

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();

        await task.access.revoke(session1, session2);

        await expect(authorizeTaskAccess(session2.action(), task.id, "View")).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("access policy revocation doesn\u2019t remove access when collection access remains", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const collection = await TestTaskCollection.create(session1);
        await collection.access.grantDefault(session1);

        const task = await TestTask.create(session1);
        await task.addCollection(session1, collection);

        await task.access.grant(session1, session2, "View");
        await task.access.revoke(session1, session2);

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(true);
    });

    test("access policy grants access even after assignee is removed", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.updateAssignee(session1, session2);
        await task.access.grant(session1, session2, "View");

        await task.updateAssignee(session1, null);

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(true);
    });

    test("access policy revocation doesn\u2019t remove access when assignee access remains", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.updateAssignee(session1, session2);
        await task.access.grant(session1, session2, "View");
        await task.access.revoke(session1, session2);

        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), task.id, "View"))?.ok,
        ).toEqual(true);
    });

    test("access policy grants access to child tasks via parent", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const parentTask = await TestTask.create(session1);
        const childTask = await TestTask.create(session1, {parent: parentTask});

        await parentTask.access.grant(session1, session2, "View");

        await expect(
            authorizeTaskAccess(session2.action(), childTask.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), childTask.id, "View"))?.ok,
        ).toEqual(true);
    });

    test("access policy revocation doesn\u2019t remove access when parent access remains", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const parentTask = await TestTask.create(session1);
        const childTask = await TestTask.create(session1, {parent: parentTask});

        await parentTask.access.grant(session1, session2, "View");
        await childTask.access.grant(session1, session2, "View");
        await childTask.access.revoke(session1, session2);

        await expect(
            authorizeTaskAccess(session2.action(), childTask.id, "View"),
        ).resolves.not.toThrow();
        expect(
            (await authorizeTaskAccessIfPossible(session2.action(), childTask.id, "View"))?.ok,
        ).toEqual(true);
    });

    test("revoking parent access policy removes access to child task", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const parentTask = await TestTask.create(session2);
        const childTask = await TestTask.create(session2, {parent: parentTask});

        await parentTask.access.grant(session2, session1, "View");

        await expect(
            authorizeTaskAccess(session1.action(), childTask.id, "View"),
        ).resolves.not.toThrow();

        await parentTask.access.revoke(session2, session1);

        await expect(authorizeTaskAccess(session1.action(), childTask.id, "View")).rejects.toThrow(
            PermissionDeniedError,
        );

        expect(
            (await authorizeTaskAccessIfPossible(session1.action(), childTask.id, "View"))?.ok,
        ).toEqual(false);
    });

    test("task creator can remove their own access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const task = await TestTask.create(session1);

        await task.access.grant(session1, session2, "Manage");
        await task.access.revoke(session1, session1);

        await expect(authorizeTaskAccess(session1.action(), task.id, "View")).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(
            authorizeTaskAccess(session2.action(), task.id, "View"),
        ).resolves.not.toThrow();
    });
});
