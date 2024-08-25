import {
    ServerActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {Context} from "~/shared/context/context.js";

type SearchActionExtraContextModules = {
    opensearch: OpensearchContextModule;
};

export type SearchActionContextModules = ServerActionContextModules &
    SearchActionExtraContextModules;

export type SearchActionContext = Context<SearchActionContextModules>;

export type SearchSessionActionContextModules = ServerSessionActionContextModules &
    SearchActionExtraContextModules;

export type SearchSessionActionContext = Context<SearchSessionActionContextModules>;

export type SearchSystemActionContextModules = ServerSystemActionContextModules &
    SearchActionExtraContextModules;

export type SearchSystemActionContext = Context<SearchSystemActionContextModules>;
