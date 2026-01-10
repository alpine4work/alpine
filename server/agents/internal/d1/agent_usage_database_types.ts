import {InferSelectModel} from "drizzle-orm";
import {
    accountEntitlements,
    agentRequestsTable,
    agentUsageWindowsTable,
} from "~/server/agents/internal/d1/agent_usage_schema.js";

export type AgentRequest = InferSelectModel<typeof agentRequestsTable>;
export type AgentUsageWindow = InferSelectModel<typeof agentUsageWindowsTable>;
export type AccountEntitlements = InferSelectModel<typeof accountEntitlements>;
