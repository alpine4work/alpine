import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {
    computeSetMessageReaction,
    findMessageReactionPosIfPossible,
} from "~/shared/messaging/compute_set_message_reaction.js";
import {getMessageReactionsByCanonicalPos} from "~/shared/messaging/get_message_reactions_by_canonical_pos.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";

const schema = MessageContentProsemirrorSchema;
const heartReaction = {
    character: {type: "Cat", variant: "Grey"},
    emotion: "Heart",
} as const;

test("keeps reactions on a stream paragraph when a later paragraph arrives", () => {
    const content = createSimpleMessageContent("Before");
    const firstStreamPartContent = createSimpleMessageContent("First");
    const secondStreamPartContent = createSimpleMessageContent("Second");

    const result = findMessageReactionPosIfPossible({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: firstStreamPartContent,
                        },
                    },
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:02.000Z"),
                        payload: {
                            type: "Content",
                            content: secondStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: content.content.size + 1,
    });

    expect(result).toMatchObject({
        ok: true,
        value: {
            pos: content.content.size + firstStreamPartContent.content.size,
        },
    });
});

test("allows reactions on the mutable part of an incomplete stream", () => {
    const content = createSimpleMessageContent("Before");
    const frozenStreamPartContent = createSimpleMessageContent("Frozen");
    const mutableStreamPartContent = createSimpleMessageContent("Mutable");

    const result = findMessageReactionPosIfPossible({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: frozenStreamPartContent,
                        },
                    },
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:02.000Z"),
                        payload: {
                            type: "Content",
                            content: mutableStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: content.content.size + frozenStreamPartContent.content.size + 1,
    });

    expect(result).toMatchObject({
        ok: true,
        value: {
            pos:
                content.content.size +
                frozenStreamPartContent.content.size +
                mutableStreamPartContent.content.size,
        },
    });
});

test("allows reactions when an incomplete stream has no completed parts", () => {
    const content = createSimpleMessageContent();
    const mutableStreamPartContent = createSimpleMessageContent("Mutable");

    const result = findMessageReactionPosIfPossible({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: mutableStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: 1,
    });

    expect(result).toMatchObject({
        ok: true,
        value: {
            pos: mutableStreamPartContent.content.size,
        },
    });
});

test("sets reactions on an incomplete stream part that grew after the client picked a position", () => {
    const content = createSimpleMessageContent();
    const clientStreamPartContent = createSimpleMessageContent("Mut");
    const serverStreamPartContent = createSimpleMessageContent("Mutable");
    const actorAccountId = generateId<AccountId>();

    const payload = computeSetMessageReaction({
        actorAccountId,
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 1,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: serverStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: clientStreamPartContent.content.size,
        reaction: "GenericLike",
    });

    expect(payload.reactionsByPos.get(serverStreamPartContent.content.size)?.get()).toEqual(
        new Map([[actorAccountId, "GenericLike"]]),
    );
});

test("keeps separate reaction targets for separate stream paragraphs", () => {
    const content = createSimpleMessageContent();
    const streamPartContent = createMessageContentWithParagraphs("First", "Second");

    const result = findMessageReactionPosIfPossible({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: streamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: 1,
    });

    expect(result).toMatchObject({
        ok: true,
        value: {
            pos: streamPartContent.child(0).nodeSize,
        },
    });
});

test("keeps displayed stream reactions on the original paragraph after later paragraphs arrive", () => {
    const actorAccountId = generateId<AccountId>();
    const content = createSimpleMessageContent();
    const firstStreamPartContent = createSimpleMessageContent("First");
    const secondStreamPartContent = createSimpleMessageContent("Second");

    const reactionsByPos = getMessageReactionsByCanonicalPos({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: new Map([
                    [
                        firstStreamPartContent.content.size,
                        new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
                    ],
                ]),
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: firstStreamPartContent,
                        },
                    },
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:02.000Z"),
                        payload: {
                            type: "Content",
                            content: secondStreamPartContent,
                        },
                    },
                ],
            },
        },
    });

    expect(reactionsByPos).toEqual(
        new Map([
            [
                firstStreamPartContent.content.size,
                new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
            ],
        ]),
    );
});

test("setting stream reactions removes stale reactions in the same paragraph", () => {
    const actorAccountId = generateId<AccountId>();
    const content = createSimpleMessageContent();
    const staleStreamPartContent = createSimpleMessageContent("Mut");
    const currentStreamPartContent = createSimpleMessageContent("Mutable");

    const payload = computeSetMessageReaction({
        actorAccountId,
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: new Map([
                    [
                        staleStreamPartContent.content.size,
                        new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
                    ],
                ]),
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: currentStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: staleStreamPartContent.content.size,
        reaction: heartReaction,
    });

    expect(payload.reactionsByPos).toEqual(
        new Map([
            [
                currentStreamPartContent.content.size,
                new ReactionSet(new Map([[actorAccountId, heartReaction]])),
            ],
        ]),
    );
});

test("deleting stream reactions removes stale reactions in the same paragraph", () => {
    const actorAccountId = generateId<AccountId>();
    const content = createSimpleMessageContent();
    const staleStreamPartContent = createSimpleMessageContent("Mut");
    const currentStreamPartContent = createSimpleMessageContent("Mutable");

    const payload = computeDeleteMessageReaction({
        actorAccountId,
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: new Map([
                    [
                        staleStreamPartContent.content.size,
                        new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
                    ],
                    [
                        currentStreamPartContent.content.size,
                        new ReactionSet(new Map([[actorAccountId, heartReaction]])),
                    ],
                ]),
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: null,
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: currentStreamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: staleStreamPartContent.content.size,
    });

    expect(payload.reactionsByPos).toEqual(new Map());
});

test("maps reactions inside a completed stream part to that part\u2019s block boundary", () => {
    const content = createSimpleMessageContent("Before");
    const streamPartContent = createSimpleMessageContent("After");

    const result = findMessageReactionPosIfPossible({
        message: {
            payload: {
                type: "Content",
                parent: null,
                content,
                contentUpdate: null,
                fileIds: [],
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: {
                createdTime: new Date("2026-01-01T00:00:00.000Z"),
                completedTime: new Date("2026-01-01T00:00:02.000Z"),
                parts: [
                    {
                        version: 0,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: streamPartContent,
                        },
                    },
                ],
            },
        },
        contentVersion: 0,
        pos: content.content.size + 1,
    });

    expect(result).toMatchObject({
        ok: true,
        value: {
            pos: content.content.size + streamPartContent.content.size,
        },
    });
});

/**
 * Creates message content with one top-level paragraph per input string.
 */
function createMessageContentWithParagraphs(...paragraphs: ReadonlyArray<string>): MessageContent {
    return assertMessageContent(
        schema.node(
            "doc",
            {},
            paragraphs.map(paragraph => schema.node("paragraph", {}, [schema.text(paragraph)])),
        ),
    );
}
