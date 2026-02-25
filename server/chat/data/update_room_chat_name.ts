import {authorizeChatAccessAndReturnItem} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Updates the name of a room chat.
 *
 * If you want to get the `ChatModel` after this update we return a `Lazy` and
 * when you call `get()` it builds the chat model.
 */
export function updateRoomChatName(
    context: ServerSessionActionContext,
    {
        chatId,
        name,
    }: {
        chatId: ChatId;
        name: string;
    },
): Promise<{get(context: ServerActionContext): Promise<ChatModel>}> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    return context.dynamo.retryTransaction(async context => {
        const attributesItem = await authorizeChatAccessAndReturnItem(context, chatId, "Manage");

        if (attributesItem.definition.type !== "Room") {
            throw new FailedPreconditionError("Can only update a room chat\u2019s name");
        }

        const newAttributesItem = await ChatTable.directlyUpdateItem(context, {
            ...attributesItem,
            definition: {
                ...attributesItem.definition,
                name,
            },
        });

        // Reindex the chat with the chat's new name. Will need to reindex all
        // messages in the chat.
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: attributesItem.spaceId,
            update: {
                type: "Chat",
                chatId,
                updatedTraits: {type: "Some", traits: ["Definition"]},
            },
        });

        return {
            get: (context: ServerActionContext) =>
                createChatModelFromItem(context, {
                    attributesItem: newAttributesItem,
                    accountItems: emptyArray,
                }),
        };
    });
}
