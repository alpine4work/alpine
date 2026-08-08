import {DiscoveryContextModule} from "~/server/context/discovery_context_module.js";
import {Context} from "~/shared/context/context.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

function createDiscoveryContext() {
    return Context.new({discovery: new DiscoveryContextModule()});
}

test("discovers a `SpaceId` from a loader", () => {
    const context = createDiscoveryContext();
    const spaceId = generateId<SpaceId>();

    context.discovery.discoverSpaceId(spaceId, "AuthorizeAccess");

    expect(context.discovery.getDiscoveredSpaceId()).toBe(spaceId);
});

test("a header discovery is not reported as a loader discovery", () => {
    const context = createDiscoveryContext();

    context.discovery.discoverSpaceId(generateId<SpaceId>(), "Header");

    expect(context.discovery.getDiscoveredSpaceIdFromNonHeaderOriginIfExists()).toBe(null);
});

test("a loader discovery after a header discovery is reported as a loader discovery", () => {
    const context = createDiscoveryContext();
    const spaceId = generateId<SpaceId>();

    context.discovery.discoverSpaceId(spaceId, "Header");
    context.discovery.discoverSpaceId(spaceId, "Pathname");

    expect(context.discovery.getDiscoveredSpaceIdFromNonHeaderOriginIfExists()).toBe(spaceId);
});

test("notifies listeners added after a header discovery when a loader discovers", () => {
    const context = createDiscoveryContext();
    const spaceId = generateId<SpaceId>();
    context.discovery.discoverSpaceId(spaceId, "Header");

    const listener = import.meta.jest.fn();
    context.discovery.addDiscoverSpaceIdListener(listener);
    context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");

    expect(listener).toHaveBeenCalledWith(spaceId);
});

test("throws when a loader discovers a different `SpaceId` than the header", () => {
    const context = createDiscoveryContext();
    const spaceIdFromHeader = generateId<SpaceId>();
    const spaceIdFromLoader = generateId<SpaceId>();
    context.discovery.discoverSpaceId(spaceIdFromHeader, "Header");

    expect(() => context.discovery.discoverSpaceId(spaceIdFromLoader, "AuthorizeAccess")).toThrow(
        `Discovered \`SpaceId\` \`${spaceIdFromLoader}\` doesn\u2019t match the \`SpaceId\` \`${spaceIdFromHeader}\` from the navigation header`,
    );
});

test("ignores a loader discovery after another loader discovery", () => {
    const context = createDiscoveryContext();
    const spaceId = generateId<SpaceId>();

    context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");
    context.discovery.discoverSpaceId(generateId<SpaceId>(), "AuthorizeAccess");

    expect(context.discovery.getDiscoveredSpaceId()).toBe(spaceId);
});

test("ignores a header discovery after a loader discovery", () => {
    const context = createDiscoveryContext();
    const spaceId = generateId<SpaceId>();

    context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");
    context.discovery.discoverSpaceId(generateId<SpaceId>(), "Header");

    expect(context.discovery.getDiscoveredSpaceIdFromNonHeaderOriginIfExists()).toBe(spaceId);
});
