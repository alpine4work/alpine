import {MessageList} from "~/client/messaging/message_list.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const account = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: new Date(),
        removal: null,
        role: "Member",
    },
});

const loadFromStart = (options: {
    limit: number;
    afterMessageIndex: number | null;
    beforeMessageIndex: number | null;
}): Promise<{
    messageCount: number;
    messages: ReadonlyArray<ChatMessageModel>;
    otherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> => {
    const promise = new Promise<never>(() => {});

    (promise as any)._options = {
        type: "loadFromStart",
        ...options,
    };

    return promise;
};

const loadFromEnd = (options: {
    limit: number;
    afterMessageIndex: number | null;
    beforeMessageIndex: number | null;
}): Promise<{
    messageCount: number;
    messages: ReadonlyArray<ChatMessageModel>;
    otherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> => {
    const promise = new Promise<never>(() => {});

    (promise as any)._options = {
        type: "loadFromEnd",
        ...options,
    };

    return promise;
};

function testTryLoadingMessages({
    messages,
    range,
}: {
    messages: MessageList<ChatMessageModel>;
    range: {startIndex: number; endIndex: number} | null;
}):
    | {
          isLoading: false;
      }
    | {
          isLoading: true;
          wasJump: boolean;
          options: {
              type: "loadFromStart" | "loadFromEnd";
              limit: number;
              afterMessageIndex: number | null;
              beforeMessageIndex: number | null;
          };
      } {
    const result = tryLoadingMessages({
        viewHeight: 1080,
        messages,
        range,
        loadFromStart,
        loadFromEnd,
    });

    if (!result.isLoading) return result;

    return {
        isLoading: true,
        wasJump: result.wasJump,
        options: (result.promise as any)._options,
    };
}

test("will load messages when there are messages at the start", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 0, endIndex: 20},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 33, endIndex: 53},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 34, endIndex: 54},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 43, endIndex: 63},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: null,
        },
    });
});

test("will load messages when there are messages at the start from multiple loads", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 20;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${loadMessageCount + index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: loadMessageCount * 1.5 + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${loadMessageCount * 1.5 + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 0, endIndex: 20},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 29, endIndex: 49},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 30, endIndex: 50},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 49,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 40, endIndex: 60},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 49,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: null,
        },
    });
});

test("will load messages when there are messages at the end", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 479, endIndex: 499},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 446, endIndex: 466},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 445, endIndex: 465},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 435, endIndex: 455},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: 446,
        },
    });
});

test("will load messages when there are messages at the end from multiple loads", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 20;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount * 2 + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount * 2 + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount * 2.5 + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount * 2.5 + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 479, endIndex: 499},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 450, endIndex: 470},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 449, endIndex: 469},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 450,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 440, endIndex: 460},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 450,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: 450,
        },
    });
});

test("will load messages when there are messages at the start and end", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 0, endIndex: 20},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 33, endIndex: 53},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 34, endIndex: 54},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 43, endIndex: 63},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 479, endIndex: 499},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 446, endIndex: 466},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 445, endIndex: 465},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 435, endIndex: 455},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: 446,
        },
    });
});

test("will load messages when there are messages at the start, end, and middle", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: 300 + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${300 + index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 0, endIndex: 20},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 33, endIndex: 53},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 34, endIndex: 54},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 43, endIndex: 63},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 479, endIndex: 499},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 446, endIndex: 466},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 445, endIndex: 465},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 435, endIndex: 455},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 299, endIndex: 319},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 300,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 290, endIndex: 310},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 300,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 333, endIndex: 353},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 334, endIndex: 354},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 353,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 343, endIndex: 363},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 353,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 200, endIndex: 220},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 154,
            beforeMessageIndex: 300,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 400, endIndex: 420},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 354,
            beforeMessageIndex: 446,
        },
    });
});

test("will load messages when there are messages at the end when there are some individual messages in the way", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: messageCount - loadMessageCount + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(
                                `Test ${messageCount - loadMessageCount + index}`,
                            ),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: [
            new ChatMessageModel({
                chatId,
                index: 420,
                author: account,
                createdTime: new Date(),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test 400"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                    files: [],
                },
            }),
            new ChatMessageModel({
                chatId,
                index: 423,
                author: account,
                createdTime: new Date(),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test 403"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                    files: [],
                },
            }),
        ],
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 479, endIndex: 499},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 446, endIndex: 466},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 445, endIndex: 465},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 435, endIndex: 455},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromEnd",
            limit: 75,
            afterMessageIndex: null,
            beforeMessageIndex: 446,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: 420,
        },
    });
});

test("will load messages when there are messages at the start when there are some individual messages in the way", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 54;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: [
            new ChatMessageModel({
                chatId,
                index: 70,
                author: account,
                createdTime: new Date(),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test 400"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                    files: [],
                },
            }),
            new ChatMessageModel({
                chatId,
                index: 73,
                author: account,
                createdTime: new Date(),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: {
                        doc: createSimpleMessageContent("Test 403"),
                        references: emptyContentReferences,
                    },
                    contentUpdatedTime: null,
                    files: [],
                },
            }),
        ],
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 0, endIndex: 20},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 33, endIndex: 53},
        }),
    ).toEqual({
        isLoading: false,
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 34, endIndex: 54},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 43, endIndex: 63},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 53,
            beforeMessageIndex: null,
        },
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 300, endIndex: 320},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: true,
        options: {
            type: "loadFromStart",
            limit: 112,
            afterMessageIndex: 254,
            beforeMessageIndex: null,
        },
    });
});

test("will load messages in the middle of two loaded ranges", () => {
    const chatId = generateId<ChatId>();

    const messageCount = 500;

    let messages = MessageList.new<ChatMessageModel>({
        messageCount,
        lastMessageChangeTime: null,
    });

    const loadMessageCount = 100;

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    messages = messages.loadMessages({
        messageCount,
        messages: createArrayWithLength(
            loadMessageCount,
            index =>
                new ChatMessageModel({
                    chatId,
                    index: 110 + index,
                    author: account,
                    createdTime: new Date(),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: {
                            doc: createSimpleMessageContent(`Test ${110 + index}`),
                            references: emptyContentReferences,
                        },
                        contentUpdatedTime: null,
                        files: [],
                    },
                }),
        ),
        otherReferencedMessages: [],
    });

    expect(
        testTryLoadingMessages({
            messages,
            range: {startIndex: 95, endIndex: 115},
        }),
    ).toEqual({
        isLoading: true,
        wasJump: false,
        options: {
            type: "loadFromStart",
            limit: 75,
            afterMessageIndex: 99,
            beforeMessageIndex: 110,
        },
    });
});
