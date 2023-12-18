import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {searchByKeywords, searchBySemantics} from "~/server/search/data/search_entity_index.js";
import * as definition from "~/shared/rpc/search_rpc_definitions.js";

implementRpc(definition.searchByKeywords, {visibility: ["AppClient"]}, async (context, input) => {
    return searchByKeywords(context.actor.authorizeSession(), input);
});

implementRpc(definition.searchBySemantics, {visibility: ["AppClient"]}, async (context, input) => {
    return searchBySemantics(context.actor.authorizeSession(), input);
});
