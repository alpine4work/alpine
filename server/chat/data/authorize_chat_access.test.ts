import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    authorizeChatAccess,
    authorizeChatAccessForAccount,
    authorizeChatAccessIfPossible,
} from "~/server/chat/data/authorize_chat_access.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {getChat} from "~/server/chat/data/get_chat.js";
import {getChatAccountIds} from "~/server/chat/data/get_chat_account_ids.js";
import {getChatAndInitialMessages} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
});

let scenario: Awaited<ReturnType<typeof createScenario>>;

beforeAll(async () => {
    scenario = await createScenario();
});

async function createScenario() {
    const s1 = await TestSpace.create(context);
    const s2 = await TestSpace.create(context);

    const a1 = await s1.createSession({role: "Admin"});
    const [a2, a3, a4] = await s1.createSessions(3);
    const a5 = await s2.createSession({role: "Admin"});

    const a6 = await s1.createSession();

    await s2.addAccount(a1);

    const b1 = await TestBot.createAndInstantiate(a1);
    const b2 = await TestBot.createAndInstantiate(a5);
    const b3 = await TestBot.createAndInstantiate(a1);

    const chatForA1 = await TestChat.get(a1);
    await chatForA1.sendMessage(a1);

    const chatForA1InS2 = await TestChat.get(await a1.forSpace(s2));
    await chatForA1InS2.sendMessage(a1);

    const chatForA2 = await TestChat.get(a2);
    await chatForA2.sendMessage(a2);

    const chatForA5 = await TestChat.get(a5);
    await chatForA5.sendMessage(a5);

    const chatForA1AndA2 = await TestChat.get(a1, a2);
    await chatForA1AndA2.sendMessage(a1);

    const chatForA1AndA3 = await TestChat.get(a1, a3);
    await chatForA1AndA3.sendMessage(a1);

    const chatForA1AndA2AndA3 = await TestChat.get(a1, a2, a3);
    await chatForA1AndA2AndA3.sendMessage(a1);

    const chatForA1AndA2AndA3AndA4 = await TestChat.get(a1, a2, a3, a4);
    await chatForA1AndA2AndA3AndA4.sendMessage(a1);

    const chatForA2AndA3 = await TestChat.get(a2, a3);
    await chatForA2AndA3.sendMessage(a2);

    const chatForA2AndA3AndA4 = await TestChat.get(a2, a3, a4);
    await chatForA2AndA3AndA4.sendMessage(a2);

    const chatForA5AndA1 = await TestChat.get(a5, a1);
    await chatForA5AndA1.sendMessage(a1);

    const chatForA1AndB1 = await TestChat.get(a1, b1);
    await chatForA1AndB1.sendMessage(a1);

    const chatForA2AndB1 = await TestChat.get(a2, b1);
    await chatForA2AndB1.sendMessage(a2);

    const chatForA1AndA2AndB1 = await TestChat.get(a1, a2, b1);
    await chatForA1AndA2AndB1.sendMessage(a1);

    const chatForA1AndB1AndB3 = await TestChat.get(a1, b1, b3);
    await chatForA1AndB1AndB3.sendMessage(a1);

    const chatForA1AndA3AndB1AndB3 = await TestChat.get(a1, a3, b1, b3);
    await chatForA1AndA3AndB1AndB3.sendMessage(a1);

    const chatForA1AndB2 = await TestChat.get(await a1.forSpace(s2), b2);
    await chatForA1AndB2.sendMessage(a1);

    const chatForA5AndA1AndB2 = await TestChat.get(a5, a1, b2);
    await chatForA5AndA1AndB2.sendMessage(a1);

    const chatForA6 = await TestChat.get(a6);
    await chatForA6.sendMessage(a6);

    const chatForA1AndA6 = await TestChat.get(a1, a6);
    await chatForA1AndA6.sendMessage(a1);

    const chatForA1AndA2AndA6 = await TestChat.get(a1, a2, a6);
    await chatForA1AndA2AndA6.sendMessage(a1);

    await s1.removeAccount(a6);

    return {
        s1,
        s2,
        a1,
        a2,
        a3,
        a4,
        a5,
        a6,
        b1,
        b2,
        chatForA1,
        chatForA1InS2,
        chatForA2,
        chatForA5,
        chatForA1AndA2,
        chatForA1AndA3,
        chatForA1AndA2AndA3,
        chatForA1AndA2AndA3AndA4,
        chatForA2AndA3,
        chatForA2AndA3AndA4,
        chatForA5AndA1,
        chatForA1AndB1,
        chatForA2AndB1,
        chatForA1AndA2AndB1,
        chatForA1AndB1AndB3,
        chatForA1AndA3AndB1AndB3,
        chatForA1AndB2,
        chatForA5AndA1AndB2,
        chatForA6,
        chatForA1AndA6,
        chatForA1AndA2AndA6,
    };
}

type ExpectedResult = "PermissionDenied" | "Unauthenticated" | null;

type ChatName = keyof typeof scenario & `chat${string}`;
type SessionName = keyof typeof scenario & `a${string}`;

type ChatNameInS1 = Exclude<
    ChatName,
    | "chatForA1InS2"
    | "chatForA5"
    | "chatForA5AndA1"
    | "chatForA1AndB2"
    | "chatForA1AndB4"
    | "chatForA5AndA1AndB2"
    | "chatForA5AndA1AndB4"
>;

type ChatNameInS2 = Exclude<ChatName, ChatNameInS1>;

const testCases: Record<
    ChatName,
    {
        anonymous: ExpectedResult;
        system: Record<"s1" | "s2", ExpectedResult>;
        session: Record<SessionName, ExpectedResult>;
        impersonatedAccount: {
            s1: Record<SessionName, ExpectedResult>;
            s2: Record<"a1" | "a2" | "a5", ExpectedResult>;
        };
        bot: {
            b1: {
                session: Record<"a1" | "a2" | "a3" | "a4", ExpectedResult>;
                chat: Record<ChatNameInS1, ExpectedResult>;
            };
            b2: {
                session: Record<"a1" | "a5", ExpectedResult>;
                chat: Record<ChatNameInS2, ExpectedResult>;
            };
        };
    }
> = {
    chatForA1: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1InS2: {
        anonymous: "Unauthenticated",
        system: {
            s1: "PermissionDenied",
            s2: null,
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: null,
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: null,
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: null,
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: null,
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA2: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: "PermissionDenied",
            a2: null,
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: null,
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: null,
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: null,
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA5: {
        anonymous: "Unauthenticated",
        system: {
            s1: "PermissionDenied",
            s2: null,
        },
        session: {
            a1: "PermissionDenied",
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: null,
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: null,
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: null,
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: null,
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA2: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: null,
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: null,
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: null,
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: null,
                    chatForA1AndA2: null,
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: null,
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: null,
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA3: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: null,
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: null,
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: null,
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: null,
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: null,
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA2AndA3: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: null,
            a3: null,
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: null,
                a3: null,
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: null,
                    a3: null,
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: null,
                    chatForA1AndA2: null,
                    chatForA1AndA3: null,
                    chatForA1AndA2AndA3: null,
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: null,
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: null,
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: null,
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: null,
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA2AndA3AndA4: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: null,
            a3: null,
            a4: null,
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: null,
                a3: null,
                a4: null,
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: null,
                    a3: null,
                    a4: null,
                },
                chat: {
                    chatForA1: null,
                    chatForA2: null,
                    chatForA1AndA2: null,
                    chatForA1AndA3: null,
                    chatForA1AndA2AndA3: null,
                    chatForA1AndA2AndA3AndA4: null,
                    chatForA2AndA3: null,
                    chatForA2AndA3AndA4: null,
                    chatForA1AndB1: null,
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: null,
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: null,
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: null,
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA2AndA3: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: "PermissionDenied",
            a2: null,
            a3: null,
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: null,
                a3: null,
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: null,
                    a3: null,
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: null,
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: null,
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA2AndA3AndA4: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: "PermissionDenied",
            a2: null,
            a3: null,
            a4: null,
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: null,
                a3: null,
                a4: null,
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: null,
                    a3: null,
                    a4: null,
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: null,
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: null,
                    chatForA2AndA3AndA4: null,
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA5AndA1: {
        anonymous: "Unauthenticated",
        system: {
            s1: "PermissionDenied",
            s2: null,
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: null,
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: null,
                a2: "PermissionDenied",
                a5: null,
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: null,
                    a5: null,
                },
                chat: {
                    chatForA1InS2: null,
                    chatForA5: null,
                    chatForA5AndA1: null,
                    chatForA1AndB2: null,
                    chatForA5AndA1AndB2: null,
                },
            },
        },
    },
    chatForA1AndB1: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA2AndB1: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: "PermissionDenied",
            a2: null,
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: null,
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: null,
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: null,
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA2AndB1: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: null,
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: null,
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: null,
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: null,
                    chatForA1AndA2: null,
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: null,
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: null,
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndB1AndB3: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA3AndB1AndB3: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: null,
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: null,
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: null,
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: null,
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: null,
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndB2: {
        anonymous: "Unauthenticated",
        system: {
            s1: "PermissionDenied",
            s2: null,
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: null,
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: null,
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: null,
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: null,
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA5AndA1AndB2: {
        anonymous: "Unauthenticated",
        system: {
            s1: "PermissionDenied",
            s2: null,
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: null,
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: null,
                a2: "PermissionDenied",
                a5: null,
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: "PermissionDenied",
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: null,
                    a5: null,
                },
                chat: {
                    chatForA1InS2: null,
                    chatForA5: null,
                    chatForA5AndA1: null,
                    chatForA1AndB2: null,
                    chatForA5AndA1AndB2: null,
                },
            },
        },
    },
    chatForA6: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: "PermissionDenied",
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: "PermissionDenied",
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: "PermissionDenied",
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: "PermissionDenied",
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: "PermissionDenied",
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: null,
                    chatForA1AndA6: "PermissionDenied",
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA6: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: "PermissionDenied",
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: "PermissionDenied",
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: "PermissionDenied",
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: "PermissionDenied",
                    chatForA1AndA2: "PermissionDenied",
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: "PermissionDenied",
                    chatForA1AndA2AndB1: "PermissionDenied",
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: null,
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: "PermissionDenied",
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
    chatForA1AndA2AndA6: {
        anonymous: "Unauthenticated",
        system: {
            s1: null,
            s2: "PermissionDenied",
        },
        session: {
            a1: null,
            a2: null,
            a3: "PermissionDenied",
            a4: "PermissionDenied",
            a5: "PermissionDenied",
            a6: "PermissionDenied",
        },
        impersonatedAccount: {
            s1: {
                a1: null,
                a2: null,
                a3: "PermissionDenied",
                a4: "PermissionDenied",
                a5: "PermissionDenied",
                a6: "PermissionDenied",
            },
            s2: {
                a1: "PermissionDenied",
                a2: "PermissionDenied",
                a5: "PermissionDenied",
            },
        },
        bot: {
            b1: {
                session: {
                    a1: null,
                    a2: null,
                    a3: "PermissionDenied",
                    a4: "PermissionDenied",
                },
                chat: {
                    chatForA1: null,
                    chatForA2: null,
                    chatForA1AndA2: null,
                    chatForA1AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3: "PermissionDenied",
                    chatForA1AndA2AndA3AndA4: "PermissionDenied",
                    chatForA2AndA3: "PermissionDenied",
                    chatForA2AndA3AndA4: "PermissionDenied",
                    chatForA1AndB1: null,
                    chatForA2AndB1: null,
                    chatForA1AndA2AndB1: null,
                    chatForA1AndB1AndB3: null,
                    chatForA1AndA3AndB1AndB3: "PermissionDenied",
                    chatForA6: null,
                    chatForA1AndA6: null,
                    chatForA1AndA2AndA6: null,
                },
            },
            b2: {
                session: {
                    a1: "PermissionDenied",
                    a5: "PermissionDenied",
                },
                chat: {
                    chatForA1InS2: "PermissionDenied",
                    chatForA5: "PermissionDenied",
                    chatForA5AndA1: "PermissionDenied",
                    chatForA1AndB2: "PermissionDenied",
                    chatForA5AndA1AndB2: "PermissionDenied",
                },
            },
        },
    },
};

async function runTest(context: ServerActionContext, chatId: ChatId): Promise<ExpectedResult> {
    const result = await authorizeChatAccessIfPossible(context, chatId);

    if (result.ok) {
        await authorizeChatAccess(context, chatId);
        await getChat(context, chatId);
        await getChatAccountIds(context, chatId);
        await getChatAndInitialMessages(context, {chatId, messagesLimit: 10});

        return null;
    }

    expect((await authorizeChatAccessIfPossible(context, chatId)).error).toEqual(result.error);
    await expect(authorizeChatAccess(context, chatId)).rejects.toThrow(result.error);
    await expect(authorizeChatAccess(context, chatId)).rejects.toThrow(result.error);
    await expect(getChat(context, chatId)).rejects.toThrow(result.error);
    await expect(getChatAccountIds(context, chatId)).rejects.toThrow(result.error);
    await expect(getChatAndInitialMessages(context, {chatId, messagesLimit: 10})).rejects.toThrow(
        result.error,
    );

    if (result.error instanceof PermissionDeniedError) {
        return "PermissionDenied";
    } else if (result.error instanceof UnauthenticatedError) {
        return "Unauthenticated";
    } else {
        throw result.error;
    }
}

for (const [chatName, testCases1] of getObjectEntriesWithKeyofType(testCases)) {
    {
        const expectedResult = testCases1.anonymous;

        test(
            // eslint-disable-next-line jest/valid-title
            quote`${chatName} authorized by anonymous actor ` +
                (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
            async () => {
                expect(await runTest(context.anonymousAction(), scenario[chatName].id)).toEqual(
                    expectedResult,
                );
            },
        );
    }

    for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(testCases1.session)) {
        test(
            // eslint-disable-next-line jest/valid-title
            quote`${chatName} authorized by ${sessionName} session actor ` +
                (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
            async () => {
                expect(
                    await runTest(scenario[sessionName].action(), scenario[chatName].id),
                ).toEqual(expectedResult);
            },
        );

        for (const [otherSessionName, otherExpectedResult] of getObjectEntriesWithKeyofType(
            testCases1.session,
        )) {
            const actualExpectedResult =
                expectedResult === null && otherExpectedResult === null ? null : "PermissionDenied";

            test(
                // eslint-disable-next-line jest/valid-title
                quote`${chatName} authorized by ${sessionName} session actor for ${otherSessionName} ` +
                    (actualExpectedResult === null
                        ? "is ok"
                        : quote`throws ${actualExpectedResult}`),
                async () => {
                    if (actualExpectedResult === null) {
                        await authorizeChatAccessForAccount(
                            scenario[sessionName].action(),
                            scenario[chatName].id,
                            scenario[otherSessionName].account.id,
                        );
                    } else {
                        await expect(
                            authorizeChatAccessForAccount(
                                scenario[sessionName].action(),
                                scenario[chatName].id,
                                scenario[otherSessionName].account.id,
                            ),
                        ).rejects.toThrow(PermissionDeniedError);
                    }
                },
            );
        }
    }

    for (const [spaceName, expectedResult] of getObjectEntriesWithKeyofType(testCases1.system)) {
        test(
            // eslint-disable-next-line jest/valid-title
            quote`${chatName} authorized by ${spaceName} system actor ` +
                (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
            async () => {
                expect(
                    await runTest(scenario[spaceName].systemAction(), scenario[chatName].id),
                ).toEqual(expectedResult);
            },
        );

        for (const [otherSessionName, otherExpectedResult] of getObjectEntriesWithKeyofType(
            testCases1.session,
        )) {
            const actualExpectedResult =
                expectedResult === null && otherExpectedResult === null ? null : "PermissionDenied";

            test(
                // eslint-disable-next-line jest/valid-title
                quote`${chatName} authorized by ${spaceName} system actor for ${otherSessionName} ` +
                    (actualExpectedResult === null
                        ? "is ok"
                        : quote`throws ${actualExpectedResult}`),
                async () => {
                    if (actualExpectedResult === null) {
                        await authorizeChatAccessForAccount(
                            scenario[spaceName].systemAction(),
                            scenario[chatName].id,
                            scenario[otherSessionName].account.id,
                        );
                    } else {
                        await expect(
                            authorizeChatAccessForAccount(
                                scenario[spaceName].systemAction(),
                                scenario[chatName].id,
                                scenario[otherSessionName].account.id,
                            ),
                        ).rejects.toThrow(PermissionDeniedError);
                    }
                },
            );
        }
    }

    for (const [spaceName, testCases2] of getObjectEntriesWithKeyofType(
        testCases1.impersonatedAccount,
    )) {
        for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(testCases2)) {
            test(
                // eslint-disable-next-line jest/valid-title
                quote`${chatName} authorized by ${sessionName} in ${spaceName} impersonated account actor ` +
                    (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
                async () => {
                    expect(
                        await runTest(
                            scenario[spaceName].impersonatedAction(scenario[sessionName]),
                            scenario[chatName].id,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }
    }

    for (const [botName, testCases2] of getObjectEntriesWithKeyofType(testCases1.bot)) {
        for (const [sessionName, expectedResult] of getObjectEntriesWithKeyofType(
            testCases2.session,
        )) {
            test(
                // eslint-disable-next-line jest/valid-title
                quote`${chatName} authorized by ${botName} bot actor in ${sessionName} account scope ` +
                    (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
                async () => {
                    expect(
                        await runTest(
                            scenario[botName].action({
                                type: "Account",
                                accountId: scenario[sessionName].account.id,
                            }),
                            scenario[chatName].id,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }

        for (const [otherChatName, expectedResult] of getObjectEntriesWithKeyofType(
            testCases2.chat,
        )) {
            test(
                // eslint-disable-next-line jest/valid-title
                quote`${chatName} authorized by ${botName} bot actor in ${otherChatName} chat scope ` +
                    (expectedResult === null ? "is ok" : quote`throws ${expectedResult}`),
                async () => {
                    expect(
                        await runTest(
                            scenario[botName].action({
                                type: "Chat",
                                chatId: scenario[otherChatName].id,
                            }),
                            scenario[chatName].id,
                        ),
                    ).toEqual(expectedResult);
                },
            );
        }
    }
}
