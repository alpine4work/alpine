import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {decodeId} from "~/shared/id/id.open_source.js";
import {getRealmId} from "~/shared/id/realm_id.open_source.js";

/**
 * We use the `RealmId` (really the first 32 bits of the `RealmId`) as the
 * `clientID` for Yjs. For this to work we must be careful to not create two
 * conflicting `TaskTitleUpdate`s within the same JavaScript realm. Otherwise if we
 * commit two conflicting updates the task title will be corrupted!
 */
export const realmTaskTitleClientId = new Lazy((): number => {
    const realmIdBytes = decodeId(getRealmId());
    const realmIdDataView = new DataView(
        realmIdBytes.buffer,
        realmIdBytes.byteOffset,
        realmIdBytes.byteLength,
    );
    return realmIdDataView.getUint32(0);
});
