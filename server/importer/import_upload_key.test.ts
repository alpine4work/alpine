import {
    assertImportUploadKey,
    createImportUploadKey,
    parseImportUploadKey,
} from "~/server/importer/import_upload_key.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

describe("createImportUploadKey", () => {
    test("creates key in correct format", () => {
        const spaceId = generateId<SpaceId>();
        const importId = generateId<NotionImportId>();

        const key = createImportUploadKey({
            spaceId,
            type: "notion",
            importId,
        });

        expect(key).toBe(`${spaceId}/notion/${importId}`);
    });
});

describe("assertImportUploadKey", () => {
    test("returns valid key", () => {
        const spaceId = generateId<SpaceId>();
        const importId = generateId<NotionImportId>();
        const key = `${spaceId}/notion/${importId}`;

        expect(assertImportUploadKey(key)).toBe(key);
    });

    test("throws for invalid key", () => {
        expect(() => assertImportUploadKey("invalid")).toThrow();
    });

    test("throws for unknown service", () => {
        const spaceId = generateId<SpaceId>();
        const importId = generateId<NotionImportId>();

        expect(() => assertImportUploadKey(`${spaceId}/unknown/${importId}`)).toThrow();
    });
});

describe("parseImportUploadKey", () => {
    test("parses valid Notion import key", () => {
        const spaceId = generateId<SpaceId>();
        const importId = generateId<NotionImportId>();
        const key = createImportUploadKey({spaceId, type: "notion", importId});

        expect(parseImportUploadKey(key)).toMatchObject({
            type: "notion",
            spaceId,
            importId,
        });
    });

    test("round-trip: create then parse returns original components", () => {
        const spaceId = generateId<SpaceId>();
        const importId = generateId<NotionImportId>();

        const key = createImportUploadKey({spaceId, type: "notion", importId});
        const parsed = parseImportUploadKey(key);

        expect(parsed).toMatchObject({
            type: "notion",
            spaceId,
            importId,
        });
    });
});
