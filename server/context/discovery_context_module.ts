import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Context module that allows code at the root of the call stack to be immediately
 * notified when certain information is "discovered" much deeper in the call stack
 * without changing the structure of the code.
 *
 * For example, when we load the route `/doc/:documentId` we need to know the space
 * the document is in as quickly as possible so we can load the space chrome around
 * the document. The moment the document discovers its `SpaceId` (in practice we
 * call `discoverSpaceId()` in `evaluateAccessPolicy()`) we call
 * `discoverSpaceId()` with that `SpaceId` so we can start loading the space
 * chrome.
 *
 * If you don't care about what happens when a `SpaceId` is discovered you may
 * provide `noop` when constructing this context module.
 */
export class DiscoveryContextModule extends ContextModuleBase {
    private readonly _spaceIdRef: {current: SpaceId | null} = {current: null};
    private readonly _spaceIdEmitter = new EventEmitter<SpaceId>();

    public discoverSpaceId(spaceId: SpaceId): void {
        if (this._spaceIdRef.current !== null) return;
        this._spaceIdRef.current = spaceId;
        this._spaceIdEmitter.emit(spaceId);
    }

    public getDiscoveredSpaceId(): SpaceId | null {
        return this._spaceIdRef.current;
    }

    public addDiscoverSpaceIdListener(listener: (spaceId: SpaceId) => void): void {
        this._spaceIdEmitter.addListener(listener);
    }

    public removeDiscoverSpaceIdListener(listener: (spaceId: SpaceId) => void): void {
        this._spaceIdEmitter.removeListener(listener);
    }
}
