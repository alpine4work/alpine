import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const disconnectSlackWorkspace = defineRpc({
    name: "disconnectSlackWorkspace",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        workspaceId: Schema.string,
    },
    output: {},
});

export const disconnectSlackAccount = defineRpc({
    name: "disconnectSlackAccount",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        workspaceId: Schema.string,
    },
    output: {},
});
