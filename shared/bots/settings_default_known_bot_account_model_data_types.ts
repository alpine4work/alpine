import {BotOwnerEntity, BotOwnerEntitySchema} from "~/shared/bots/owners/bot_owner_entity.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {AccountModelDataForAvatarDesign} from "~/shared/spaces/get_account_avatar_design.js";

/**
 * The type for default account data for known bots. We use this to render a bot in
 * settings before a bot account has actually been instantiated.
 *
 * The default account data is always in the `Removed` state.
 */
export type SettingsDefaultKnownBotAccountModelData = Replace<
    DistributiveOmit<SettingsDefaultKnownBotAccountModelDataBase, "id">,
    {
        readonly bot: {readonly id: BotId; readonly ownerEntity: BotOwnerEntity};
        readonly space: {readonly state: {readonly type: "Removed"}};
        readonly reactionCharacter: null;
        readonly avatar: {readonly content: Uint8Array};
    }
>;

export const SettingsDefaultKnownBotAccountModelDataSchema: Schema<SettingsDefaultKnownBotAccountModelData> =
    Schema.object({
        name: Schema.string,
        // Mirrors how `AccountModelWithoutSpaceAndAvatarDataSchema` serializes its `bot`
        // property so both sides of `SettingsDefaultKnownBotAccountModelDataBase` keep
        // reading the same `botId` key on the wire.
        bot: Schema.object({id: Schema.id<BotId>(), ownerEntity: BotOwnerEntitySchema})
            .wrapOriginalPropertyInObject("id", {ownerEntity: {type: "System"}})
            .originalPropertyKey("botId"),
        space: Schema.object({state: Schema.object({type: Schema.value("Removed")})}),
        reactionCharacter: Schema.value(null),
        avatar: Schema.object({content: Schema.bytes}),
    });

/**
 * Type that's both `DefaultKnownBotAccountModelData` and `AccountModelData` are
 * assignable to.
 */
export type SettingsDefaultKnownBotAccountModelDataBase = AccountModelDataForAvatarDesign &
    Pick<AccountModelData, "name">;

assertAssignableTypes<
    SettingsDefaultKnownBotAccountModelDataBase,
    AccountModelDataForAvatarDesign
>();
assertAssignableTypes<AccountModelData, SettingsDefaultKnownBotAccountModelDataBase>();
assertAssignableTypes<
    SettingsDefaultKnownBotAccountModelData,
    SettingsDefaultKnownBotAccountModelDataBase
>();
