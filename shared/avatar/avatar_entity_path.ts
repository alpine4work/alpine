import {InternalError} from "~/shared/error/error.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export type AvatarEntityPath = `account/${AccountId}` | `space/${SpaceId}`;

export const AvatarEntityPathSchema = Schema.string as Schema<AvatarEntityPath>;

export type AvatarEntityPathObject =
    | {readonly type: "account"; readonly accountId: AccountId}
    | {readonly type: "space"; readonly spaceId: SpaceId};

export function parseAvatarEntityPath(entityPath: AvatarEntityPath): AvatarEntityPathObject {
    const [idType, idPayload] = entityPath.split("/");

    switch (idType) {
        case "account":
            return {type: "account", accountId: idPayload as AccountId};
        case "space":
            return {type: "space", spaceId: idPayload as SpaceId};
        default:
            throw new InternalError(quote`Unrecognized \`AvatarEntityPath\` type ${idType ?? ""}`);
    }
}

type GetAvatarEntityPathTestMapUnionType<Id extends string> = Id extends `${infer IdType}/${string}`
    ? Record<IdType, (idRest: string) => boolean>
    : Record<Id, null>;

type GetAvatarEntityPathTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetAvatarEntityPathTestMapUnionType<Id>>
>;

const avatarEntityPathTestMap: GetAvatarEntityPathTestMapType<AvatarEntityPath> = {
    account: isId,
    space: isId,
};

assertEqualTypes<keyof typeof avatarEntityPathTestMap, AvatarEntityPathObject["type"]>();

let avatarEntityPathTypes: ReadonlyArray<keyof typeof avatarEntityPathTestMap> | null = null;

export function getAvatarEntityPathTypes() {
    avatarEntityPathTypes ??= Object.keys(avatarEntityPathTestMap) as ReadonlyArray<
        keyof typeof avatarEntityPathTestMap
    >;
    return avatarEntityPathTypes;
}

export function isAvatarEntityPath(path: string): path is AvatarEntityPath {
    const [pathType = "", pathRest = ""] = path.split("/", 2);
    const pathTest = cast<{[key: string]: ((pathRest: string) => boolean) | null}>(
        avatarEntityPathTestMap,
    )[pathType];

    if (pathTest === undefined) return false;

    if (pathTest === null) {
        // Implies that `idRest` is an empty string.
        return path === pathType;
    }

    return pathTest(pathRest);
}

/**
 * Get the path corresponding to the provided `AvatarEntityPathObject`.
 */
export function printAvatarEntityObjectIntoPath(
    pathObject: AvatarEntityPathObject,
): AvatarEntityPath {
    switch (pathObject.type) {
        case "account":
            return `account/${pathObject.accountId}`;
        case "space":
            return `space/${pathObject.spaceId}`;
        default:
            throw exhaustive(pathObject);
    }
}

export function printAvatarEntityObjectIntoTracerRoute(
    path: AvatarEntityPath,
): "account/:accountId" | "space/:spaceId" {
    const pathObject = parseAvatarEntityPath(path);
    switch (pathObject.type) {
        case "account":
            return `account/:accountId`;
        case "space":
            return `space/:spaceId`;
        default:
            throw exhaustive(pathObject);
    }
}
