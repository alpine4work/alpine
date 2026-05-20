import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {RynamoTableSchema} from "~/server/dynamo/core/rynamo/rynamo_table_schema.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Create a new room chat.
 */
export async function createRoomChat(
    context: ServerSessionActionContext,
    {
        spaceId,
        chatId = generateId<ChatId>(),
        name,
        accessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [context.actor.getAccountId(), {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    }: {
        spaceId: SpaceId;
        chatId?: ChatId;
        name: string;
        accessPolicy?: CreateOrUpdateAccessPolicy;
    },
): Promise<{id: ChatId; createdTime: Date; get: () => Promise<ChatModel>}> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    await authorizeSpaceAccess(context, spaceId);

    const {resolvedAccessPolicy, transactionEntries} = await validateAccessPolicyUpdateForServer(
        context,
        spaceId,
        `Chat:${chatId}`,
        null,
        accessPolicy,
    );

    const createdTime = new Date();

    const createChatTransactionEntry = ChatTable.transactionCreateItem({
        partitionType: "Chat",
        sortRangeType: "Attributes",
        chatId,
        spaceId,
        createdTime,
        definition: {
            type: "Room",
            name,
            accessPolicy,
            creatorId: context.actor.getAccountId(),
            hasAddedFeedCandidateEntry: !!resolvedAccessPolicy.defaultGrant,
        },
        accountIdsForDirectOneOnOne: null,
        messagesSummary: {
            unknownAuthorMessageCount: 0,
            messageCountByAuthorId: new Map(),
            mentionCountByAccountId: new Map(),
        },
    });

    await RynamoTableSchema.executeTransaction(context, [
        createChatTransactionEntry,

        // Automatically subscribe our actor to the chat room they create.
        ChatTable.transactionCreateOrReplaceItem({
            partitionType: "Chat",
            sortRangeType: "Subscription",
            chatId,
            accountId: context.actor.getAccountId(),
            isSubscribed: true,
        }),

        ...transactionEntries.map(entry => entry.transactionEntry),
    ]);

    context.process.waitUntil(async () => {
        const entry: FeedEntry = {
            type: "RoomChat",
            chatId,
            sharedTime: createdTime,
            sharerId: context.actor.getAccountId(),
            creatorId: context.actor.getAccountId(),
            event: "Created",
        };

        // If we created a public channel then we immediately add it to the feed.
        if (createChatTransactionEntry.newItem.definition.hasAddedFeedCandidateEntry) {
            await addFeedCandidateEntry(context, spaceId, entry);
        }
        // If we're creating a private channel then only add an entry to the creator
        // account's personal feed.
        else {
            await addFeedAccountCandidateEntry(
                context,
                spaceId,
                context.actor.getAccountId(),
                entry,
            );
        }
    });

    // Index the chat for the first time after creation.
    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Chat",
            chatId,
            updatedTraits: {type: "None"},
        },
    });

    context.process.waitUntil(
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Chat:${chatId}`,
            interaction: {type: "HighIntentUpdate"},
            siteId: getSiteIdFromAccessPolicyIfExists(accessPolicy),
        }),
    );

    const chatModel = new Lazy(() =>
        createChatModelFromItem(context, {
            attributesItem: createChatTransactionEntry.newItem,
            accountItems: [],
        }),
    );

    return {id: chatId, createdTime, get: () => chatModel.get()};
}
