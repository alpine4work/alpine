import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {searchByKeyword} from "~/server/search/data/search_entity_index.js";
import * as definition from "~/shared/rpc/search_rpc_definitions.js";

implementRpc(definition.searchByKeyword, {visibility: ["AppClient"]}, async (context, input) => {
    return searchByKeyword(context.actor.authorizeSession(), input);
});
