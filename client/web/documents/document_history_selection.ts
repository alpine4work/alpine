import {
    DocumentHistoryDiff,
    DocumentHistoryVersionRange,
} from "~/shared/documents/document_history_model.js";

export type DocumentHistorySelection = {
    readonly range: DocumentHistoryVersionRange;
    readonly diff: DocumentHistoryDiff;
};
