import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
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
] as const;

const tokenServiceNames = [
    "AppService",
    "TaskRealtimeService",
    "JobQueueService",
    ...tokenEdgeServiceFamilyNames,
] as const;

export type TokenEdgeServiceFamilyName = (typeof tokenEdgeServiceFamilyNames)[number];
export type TokenServiceName = (typeof tokenServiceNames)[number];

export const TokenServiceNameSchema = Schema.enum<TokenServiceName>(tokenServiceNames);

// All `TokenServiceName`s are also services.
assertAssignableTypes<TokenServiceName, TracerServiceName>();

// All durable object services are also `TokenEdgeServiceFamilyName`s.
assertAssignableTypes<DurableObjectServiceName, TokenEdgeServiceFamilyName>();
