import {PeekId} from "~/shared/id/types/id_types.js";

export type PeekContext = {
    readonly id: PeekId;
    readonly withMobileLayout: boolean;
    readonly withoutSearchAffinityViewInteraction: boolean;
};
