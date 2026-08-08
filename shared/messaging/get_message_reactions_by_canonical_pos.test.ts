import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {getMessageReactionsByCanonicalPos} from "~/shared/messaging/get_message_reactions_by_canonical_pos.js";
import {MessageContentPayload, MessageStream} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";

const heartReaction = {
    character: {type: "Cat", variant: "Grey"},
    emotion: "Heart",
} as const;

test("returns content reactions unchanged when the message has no stream", () => {
    const actorAccountId = generateId<AccountId>();
    const content = createSimpleMessageContent("Hello");
    const reactionsByPos = new Map([
        [content.content.size, new ReactionSet(new Map([[actorAccountId, "GenericLike"]]))],
    ]);

    const result = getMessageReactionsByCanonicalPos({
        message: {
            payload: createContentPayload({content, reactionsByPos}),
            stream: null,
        },
    });

    expect(result).toBe(reactionsByPos);
});

test("folds stale stream reactions onto the current stream block boundary", () => {
    const actorAccountId = generateId<AccountId>();
    const staleStreamPartContent = createSimpleMessageContent("Mut");
    const currentStreamPartContent = createSimpleMessageContent("Mutable");

    const result = getMessageReactionsByCanonicalPos({
        message: {
            payload: createContentPayload({
                reactionsByPos: new Map([
                    [
                        staleStreamPartContent.content.size,
                        new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
                    ],
                ]),
            }),
            stream: createStream(currentStreamPartContent),
        },
    });

    expect(result).toEqual(
        new Map([
            [
                currentStreamPartContent.content.size,
                new ReactionSet(new Map([[actorAccountId, "GenericLike"]])),
            ],
        ]),
    );
});

test("merges reactions when stored positions collapse to the same stream block", () => {
    const firstActorAccountId = generateId<AccountId>();
    const secondActorAccountId = generateId<AccountId>();
    const staleStreamPartContent = createSimpleMessageContent("Mut");
    const currentStreamPartContent = createSimpleMessageContent("Mutable");

    const result = getMessageReactionsByCanonicalPos({
        message: {
            payload: createContentPayload({
                reactionsByPos: new Map([
                    [
                        staleStreamPartContent.content.size,
                        new ReactionSet(new Map([[firstActorAccountId, "GenericLike"]])),
                    ],
                    [
                        currentStreamPartContent.content.size,
                        new ReactionSet(new Map([[secondActorAccountId, heartReaction]])),
                    ],
                ]),
            }),
            stream: createStream(currentStreamPartContent),
        },
    });

    expect(result).toEqual(
        new Map([
            [
                currentStreamPartContent.content.size,
                new ReactionSet(
                    new Map<AccountId, Reaction | "GenericLike">([
                        [firstActorAccountId, "GenericLike"],
                        [secondActorAccountId, heartReaction],
                    ]),
                ),
            ],
        ]),
    );
});

/**
 * Creates a content payload with optional content and reactions.
 */
function createContentPayload({
    content = createSimpleMessageContent(),
    reactionsByPos = emptyMap,
}: {
    content?: MessageContent;
    reactionsByPos?: ReadonlyMap<number, ReactionSet>;
} = {}): MessageContentPayload {
    return {
        type: "Content",
        parent: null,
        content,
        contentUpdate: null,
        fileIds: [],
        reactionsByPos,
        filesReactions: emptyReactionSet,
    };
}

/**
 * Creates a stream with one content part.
 */
function createStream(content: MessageContent): MessageStream {
    return {
        createdTime: new Date("2026-01-01T00:00:00.000Z"),
        completedTime: null,
        parts: [
            {
                version: 0,
                createdTime: new Date("2026-01-01T00:00:01.000Z"),
                payload: {
                    type: "Content",
                    content,
                },
            },
        ],
    };
}
