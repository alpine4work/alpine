import {BotWithAvatarItem} from "~/server/bots/internal/bots_table.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {Bot} from "~/shared/bots/bot_schema.js";

export function createBotFromItem(botItem: BotWithAvatarItem): Bot {
    return {
        id: botItem.id,
        name: botItem.name,
        avatar: createAvatarModelFromItem(botItem.avatar),
    };
}
