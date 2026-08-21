import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

/** An operation an actor may perform with a bot. */
export type BotOperation =
    // Can an account view this bot's details?
    | {readonly type: "View"}
    // Can an account manage this bot's settings?
    | {readonly type: "Manage"}
    // Can an account install this bot in a space?
    | {readonly type: "Install"; readonly spaceId: SpaceId}
    // Can an account view this bot's space-specific settings that are shared for all
    // accounts in the space?
    | {readonly type: "ViewSpaceSettings"; readonly spaceId: SpaceId}
    // Can an account manage this bot's space-specific settings that are shared for all
    // accounts in the space?
    | {readonly type: "ManageSpaceSettings"; readonly spaceId: SpaceId}
    // Can an account view this bot's space-specific settings for a particular actor?
    | {
          readonly type: "ViewSpaceSettingsForActor";
          readonly spaceId: SpaceId;
          readonly accountId: AccountId;
      }
    // Can an account manage this bot's space-specific settings for a particular actor?
    | {
          readonly type: "ManageSpaceSettingsForActor";
          readonly spaceId: SpaceId;
          readonly accountId: AccountId;
      }
    // Can an account message this bot's space account?
    | {readonly type: "Message"; readonly spaceId: SpaceId};

/** The kind of an operation an actor may perform with a bot. */
export type BotOperationType = BotOperation["type"];

// Keying by operation type makes TypeScript require an entry for every
// `BotOperation` variant, so adding a new operation forces updating this list
// instead of silently dropping it from the schema.
const botOperationTypeByType: {[Type in BotOperationType]: Type} = {
    View: "View",
    Manage: "Manage",
    Install: "Install",
    ViewSpaceSettings: "ViewSpaceSettings",
    ManageSpaceSettings: "ManageSpaceSettings",
    ViewSpaceSettingsForActor: "ViewSpaceSettingsForActor",
    ManageSpaceSettingsForActor: "ManageSpaceSettingsForActor",
    Message: "Message",
};

/** Every `BotOperationType`. */
export const allBotOperationTypes = Object.values(botOperationTypeByType);

export const BotOperationTypeSchema = Schema.enum(allBotOperationTypes);
