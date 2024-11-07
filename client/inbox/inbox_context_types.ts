import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export type InboxContextNavigation = {
    readonly nextEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    readonly previousEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    readonly selectEntry: (
        entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null,
    ) => Promise<void>;
};

export type InboxContext = {
    readonly entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    readonly navigation: InboxContextNavigation | null;
    readonly onCreateMessageOptimistically: (promise: Promise<unknown>) => void;
};
