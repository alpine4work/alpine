import {BotWithAvatarItem} from "~/server/bots/internal/bots_table.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {Bot} from "~/shared/bots/bot_schema.js";
import {parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";

export function createBotFromItem(botItem: BotWithAvatarItem): Bot {
    return {
        id: botItem.id,
        ownerEntity: parseBotOwnerEntityId(botItem.ownerEntity),
        name: botItem.name,
        createdTime: botItem.createdTime,
        description: botItem.description,
        avatar: createAvatarModelFromItem(botItem.avatar),
    };
}
