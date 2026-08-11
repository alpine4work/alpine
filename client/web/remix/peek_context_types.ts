import {Memo} from "react";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {PeekId} from "~/shared/id/types/id_types.open_source.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";

export type PeekContext = {
    readonly id: PeekId;
    readonly layout: RouteLayout;
    readonly stack: Memo<{
        readonly showTaskAutoSaveHint: () => void;
    }> | null;
    readonly withoutSearchAffinityViewEntityInteraction: boolean;
    /**
     * When set, handles navigation away from an entity immediately before it is
     * deleted.
     */
    readonly onBeforeEntityDelete: ((entityId: SearchEntityId) => void) | null;
};
