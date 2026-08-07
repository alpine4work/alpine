import {getMessageReactionsForSearchParam} from "~/app/helpers/get_message_reactions_for_search_param.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";

test("returns stream reactions stored at a stale position from the canonical URL position", () => {
    const actorAccountId = generateId<AccountId>();
    const staleStreamPartContent = createSimpleMessageContent("Mut");
    const currentStreamPartContent = createSimpleMessageContent("Mutable");

    const reactions = getMessageReactionsForSearchParam(
        new URL(`https://example.com/?at=${currentStreamPartContent.content.size}@0`),
        {
            payload: {
                type: "Content",
                parent: null,
                content: createSimpleMessageContent(),
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
                        version: 1,
                        createdTime: new Date("2026-01-01T00:00:01.000Z"),
                        payload: {
                            type: "Content",
                            content: currentStreamPartContent,
                        },
                    },
                ],
            },
        },
    );

    expect(reactions.get()).toEqual(new Map([[actorAccountId, "GenericLike"]]));
});
