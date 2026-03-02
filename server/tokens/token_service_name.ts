import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {Schema} from "~/shared/schema/schema.js";
import {DurableObjectServiceName, TracerServiceName} from "~/shared/tracer/tracer_root.js";

const tokenEdgeServiceFamilyNames = [
    "EdgeService",
    "DocumentCollaborationService",
    "PostRealtimeService",
    "ChannelRealtimeService",
    "ChatRealtimeService",
    "MyAccountService",
    "TaskNotesCollaborationService",
    "DatabaseService",
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tokenServiceNames = [
    "AppService",
    "TaskRealtimeService",
    "JobQueueService",
    "FileProcessorService",
    "ApiService",
    "ResourceService",
    ...tokenEdgeServiceFamilyNames,
] as const;

export type TokenEdgeServiceFamilyName = (typeof tokenEdgeServiceFamilyNames)[number];
export type TokenServiceName = (typeof tokenServiceNames)[number];

export const tokenServiceShortNameByName: {[Key in TokenServiceName]: string} = {
    AppService: "app",
    TaskRealtimeService: "tsk",
    JobQueueService: "job",
    FileProcessorService: "flp",
    ApiService: "api",
    ResourceService: "rsr",
    EdgeService: "edg",
    DocumentCollaborationService: "doc",
    PostRealtimeService: "pst",
    ChannelRealtimeService: "chl",
    ChatRealtimeService: "cht",
    MyAccountService: "acc",
    TaskNotesCollaborationService: "tkn",
    DatabaseService: "dbs",
};

let tokenServiceNameByShortName: ReadonlyMap<string, TokenServiceName> | undefined;

export function getTokenServiceNameByShortName() {
    tokenServiceNameByShortName ??= new Map(
        getObjectEntriesWithKeyofType(tokenServiceShortNameByName).map(
            ([tokenServiceName, shortName]) => [shortName, tokenServiceName],
        ),
    );
    return tokenServiceNameByShortName;
}

export const TokenServiceNameSchema = Schema.enum(tokenServiceShortNameByName)
    .transform<TokenServiceName>({
        serialize: name => tokenServiceShortNameByName[name],
        deserialize: name => getTokenServiceNameByShortName().get(name)!,
    })
    .migration({
        serialize: name => name,
        deserialize: name => {
            if (typeof name !== "string") return name;

            // NOTE(calebmer, 2024-09-24): Support token payloads created before this date.
            // When all current tokens expire we should be able to use our new format
            // exclusively and we can remove this migration.
            const shortName = (tokenServiceShortNameByName as any)[name];
            if (shortName) return shortName;

            return name;
        },
    });

// All `TokenServiceName`s are also services.
assertAssignableTypes<TokenServiceName, TracerServiceName>();

// All durable object services are also `TokenEdgeServiceFamilyName`s.
assertAssignableTypes<DurableObjectServiceName, TokenEdgeServiceFamilyName>();
