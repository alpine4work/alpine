import {AccountId, NotionImportId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    NotionImportStatusSchema,
    NotionImportTeamspaceOptionsSchema,
} from "~/shared/importer/notion/notion_import_item.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/** The type of import option for a teamspace. */
export type TeamspaceImportOptionType = "Public" | "Private" | "DoNotImport";

/**
 * Local UI state for teamspace import choices. Maps teamspaceId to visibility
 * option.
 */
export type TeamspaceImportOptionsMap = Map<string, {type: TeamspaceImportOptionType}>;

// There are certain fields that we don't need to send to the UI, and we need to
// hold the notionImportId locally.
export const LocalNotionImportItemSchema = Schema.object({
    notionImportId: Schema.id<NotionImportId>(),
    spaceId: Schema.id<SpaceId>(),
    workspaceName: Schema.string.nullable(),
    startedByAccountId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    updatedTime: Schema.date,
    startedProcessingTime: Schema.date.nullable(),
    teamspaceImportOptions: NotionImportTeamspaceOptionsSchema.nullable(),
    status: NotionImportStatusSchema,
});

export type LocalNotionImportItem = SchemaType<typeof LocalNotionImportItemSchema>;

/** Discriminated phase of the notion import flow. */
export type NotionImportPhase =
    | {type: "Idle"}
    | {type: "Uploading"; selectedFileName: string; progress: number}
    | {type: "Validating"; selectedFileName: string}
    | {
          type: "Validated";
          selectedFileName: string | null;
          teamspaceImportOptions: TeamspaceImportOptionsMap | null;
      }
    | {
          type: "Starting";
          selectedFileName: string | null;
          teamspaceImportOptions: TeamspaceImportOptionsMap;
      }
    // returnPhase represents the phase that the import will return to if we fail to
    // cancel the import.
    | {type: "Canceling"; returnPhase: NotionImportPhase};

/** Full state for the notion import state machine. */
export type NotionImportState = {
    phase: NotionImportPhase;
    isDialogOpen: boolean;
    currentImport: LocalNotionImportItem | null;
};

/** Actions dispatched to the notion import reducer. */
export type NotionImportAction =
    | {type: "OpenDialog"}
    | {type: "CloseDialog"}
    | {type: "StartUpload"; fileName: string}
    | {type: "UpdateUploadProgress"; progress: number}
    | {type: "UploadComplete"}
    | {type: "UploadFailed"}
    | {type: "PollingUpdate"; notionImport: LocalNotionImportItem}
    | {type: "PollingNotFound"}
    | {type: "UpdateTeamspaceOptions"; options: TeamspaceImportOptionsMap}
    | {type: "BeginStartImport"}
    | {type: "ImportStarted"}
    | {type: "StartImportFailed"}
    | {type: "BeginCancel"}
    | {type: "CancelComplete"}
    | {type: "CancelFailed"}
    | {
          type: "ResumeValidated";
          rawTeamspaceOptions: LocalNotionImportItem["teamspaceImportOptions"];
      };
