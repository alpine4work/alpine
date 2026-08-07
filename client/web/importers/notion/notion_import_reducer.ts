import {
    LocalNotionImportItem,
    NotionImportAction,
    NotionImportPhase,
    NotionImportState,
    TeamspaceImportOptionsMap,
} from "~/client/web/importers/notion/notion_import_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

function buildTeamspaceOptionsMap(
    options: LocalNotionImportItem["teamspaceImportOptions"],
): TeamspaceImportOptionsMap | null {
    if (!options) return null;
    const map: TeamspaceImportOptionsMap = new Map();
    for (const ts of options) {
        map.set(ts.teamspaceId, ts.option);
    }
    return map;
}

export function selectedFileNameForPhase(phase: NotionImportPhase): string | null {
    const {type} = phase;

    switch (type) {
        case "Idle":
            return null;
        case "Uploading":
        case "Validating":
        case "Validated":
        case "Starting":
            return phase.selectedFileName;
        case "Canceling":
            return selectedFileNameForPhase(phase.returnPhase);
        default:
            throw exhaustive(type);
    }
}

export function teamspaceOptionsForPhase(
    phase: NotionImportPhase,
): TeamspaceImportOptionsMap | null {
    switch (phase.type) {
        case "Validated":
        case "Starting":
            return phase.teamspaceImportOptions;
        case "Canceling":
            return teamspaceOptionsForPhase(phase.returnPhase);
        default:
            return null;
    }
}

export const notionImportInitialState: NotionImportState = {
    phase: {type: "Idle"},
    isDialogOpen: false,
    currentImport: null,
};

export function notionImportReducer(
    state: NotionImportState,
    action: NotionImportAction,
): NotionImportState {
    const {type} = action;
    switch (type) {
        case "OpenDialog":
            return {...state, isDialogOpen: true};

        case "CloseDialog":
            return {...state, isDialogOpen: false};

        case "StartUpload":
            return {
                ...state,
                phase: {type: "Uploading", selectedFileName: action.fileName, progress: 0},
            };

        case "UpdateUploadProgress": {
            if (state.phase.type !== "Uploading") return state;
            return {
                ...state,
                phase: {...state.phase, progress: action.progress},
            };
        }

        case "UploadComplete": {
            if (state.phase.type !== "Uploading") return state;
            return {
                ...state,
                phase: {type: "Validating", selectedFileName: state.phase.selectedFileName},
            };
        }

        case "UploadFailed":
            return {
                ...state,
                phase: {type: "Idle"},
                currentImport: null,
            };

        case "PollingUpdate": {
            const {notionImport} = action;

            if (notionImport.status.type === "Validated" && notionImport.teamspaceImportOptions) {
                return {
                    ...state,
                    currentImport: notionImport,
                    phase: {
                        type: "Validated",
                        selectedFileName: selectedFileNameForPhase(state.phase),
                        teamspaceImportOptions: buildTeamspaceOptionsMap(
                            notionImport.teamspaceImportOptions,
                        ),
                    },
                };
            }

            if (notionImport.status.type === "Success" || notionImport.status.type === "Failed") {
                return {
                    ...state,
                    phase: {type: "Idle"},
                    currentImport: null,
                };
            }

            return {...state, currentImport: notionImport};
        }

        case "PollingNotFound":
            return {...state, currentImport: null};

        case "UpdateTeamspaceOptions": {
            if (state.phase.type !== "Validated") return state;
            return {
                ...state,
                phase: {...state.phase, teamspaceImportOptions: action.options},
            };
        }

        case "BeginStartImport": {
            if (state.phase.type !== "Validated") return state;
            if (!state.phase.teamspaceImportOptions) return state;
            return {
                ...state,
                phase: {
                    type: "Starting",
                    selectedFileName: state.phase.selectedFileName,
                    teamspaceImportOptions: state.phase.teamspaceImportOptions,
                },
            };
        }

        case "ImportStarted":
            return notionImportInitialState;

        case "StartImportFailed": {
            if (state.phase.type !== "Starting") return state;
            return {
                ...state,
                phase: {
                    type: "Validated",
                    selectedFileName: state.phase.selectedFileName,
                    teamspaceImportOptions: state.phase.teamspaceImportOptions,
                },
            };
        }

        case "BeginCancel":
            return {
                ...state,
                phase: {type: "Canceling", returnPhase: state.phase},
            };

        case "CancelComplete":
            return notionImportInitialState;

        case "CancelFailed": {
            if (state.phase.type !== "Canceling") return state;
            return {...state, phase: state.phase.returnPhase};
        }

        case "ResumeValidated":
            return {
                ...state,
                isDialogOpen: true,
                phase: {
                    type: "Validated",
                    selectedFileName: null,
                    teamspaceImportOptions: buildTeamspaceOptionsMap(action.rawTeamspaceOptions),
                },
            };
        default:
            throw exhaustive(type);
    }
}
