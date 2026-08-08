import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Discovering a request's `SpaceId` is a state machine with two paths:
 *
 * - `Undiscovered` → `Header` → <Any Non Header>
 * - `Undiscovered` → <Any Non Header>
 *
 * When navigating within Alpine, we send the current `SpaceId` in a request header
 * so we can start loading space data immediately (`Header`). However, each route
 * is still responsible for discovering the `SpaceId` itself! If someone navigates
 * via a direct link, the header won't exist. So we only treat the `SpaceId` as
 * fully discovered once a loader or URL param reports it (<Any Non Header>).
 *
 * It's important to note that we treat all non-header discoveries as equivalent
 * and the first discovery wins. As soon as we discover the `SpaceId` through a
 * non-header origin, we will not change the origin of the discovery again.
 *
 * This can be easily changed in the future if we need to.
 */
type DiscoveredSpaceIdOrigin =
    | {type: "Undiscovered"; spaceId?: undefined}
    | {type: "Header"; spaceId: SpaceId}
    | {type: "Pathname"; spaceId: SpaceId}
    | {type: "CreateSearchParam"; spaceId: SpaceId}
    | {type: "AuthorizeAccess"; spaceId: SpaceId};

type DiscoveredSpaceIdOriginType = DiscoveredSpaceIdOrigin["type"];

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
    private readonly _spaceIdDiscoveryRef: {current: DiscoveredSpaceIdOrigin} = {
        current: {type: "Undiscovered"},
    };
    private readonly _spaceIdEmitter = new EventEmitter<SpaceId>();

    public discoverSpaceId(
        spaceId: SpaceId,
        origin: Exclude<DiscoveredSpaceIdOriginType, "Undiscovered">,
    ): void {
        const spaceIdDiscovery = this._spaceIdDiscoveryRef.current;

        switch (spaceIdDiscovery.type) {
            case "Undiscovered": {
                this._spaceIdDiscoveryRef.current = {type: origin, spaceId};
                this._spaceIdEmitter.emit(spaceId);
                return;
            }

            case "Header": {
                // The header already discovered a `SpaceId`. First discovery wins.
                if (origin === "Header") return;

                // The navigation header is client controlled, so a loader discovering a different
                // `SpaceId` means the header was wrong. Throw a loud error instead of trying to
                // render the wrong space around this route's content.
                if (spaceId !== spaceIdDiscovery.spaceId) {
                    throw new InternalError(
                        quote`Discovered \`SpaceId\` ${spaceId} doesn\u2019t match the \`SpaceId\` ${spaceIdDiscovery.spaceId} from the navigation header`,
                    );
                }

                this._spaceIdDiscoveryRef.current = {type: origin, spaceId};

                // The emit for this `SpaceId` already happened when the header discovered it. Emit
                // again so waiters gated on loader discovery can resolve. Listeners remove
                // themselves after their first call, so only waiters that registered after the
                // header discovery will see this.
                this._spaceIdEmitter.emit(spaceId);
                return;
            }

            case "CreateSearchParam":
            case "AuthorizeAccess":
            case "Pathname": {
                // We already discovered a `SpaceId` from a different origin. First discovery wins.
                return;
            }

            default:
                throw exhaustive(spaceIdDiscovery);
        }
    }

    public getDiscoveredSpaceId(): SpaceId | null {
        return this._spaceIdDiscoveryRef.current.spaceId ?? null;
    }

    /**
     * The `SpaceId` discovered by a non-header origin. Returns `null` if the `SpaceId`
     * was only discovered through the navigation header (or not at all).
     *
     * The name of this method is intentionally ugly to discourage use.
     */
    public getDiscoveredSpaceIdFromNonHeaderOriginIfExists(): SpaceId | null {
        const spaceIdDiscovery = this._spaceIdDiscoveryRef.current;
        return spaceIdDiscovery.type !== "Header" ? (spaceIdDiscovery.spaceId ?? null) : null;
    }

    public addDiscoverSpaceIdListener(listener: (spaceId: SpaceId) => void): void {
        this._spaceIdEmitter.addListener(listener);
    }

    public removeDiscoverSpaceIdListener(listener: (spaceId: SpaceId) => void): void {
        this._spaceIdEmitter.removeListener(listener);
    }
}
