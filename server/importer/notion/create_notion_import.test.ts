import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createNotionImport} from "~/server/importer/notion/create_notion_import.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {notionImportMaxZipSize} from "~/shared/importer/notion/notion_import_max_zip_size.js";

const context = createTestContext();

test("throws if zip file exceeds max size", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    await expect(
        createNotionImport(session.action(), {
            spaceId: space.id,
            contentType: "application/zip",
            contentLength: notionImportMaxZipSize + 1,
        }),
    ).rejects.toThrow("Couldn\u2019t import Notion data");
});

test("succeeds at exactly max zip size", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const {notionImportId} = await createNotionImport(session.action(), {
        spaceId: space.id,
        contentType: "application/zip",
        contentLength: notionImportMaxZipSize,
    });

    const importItem = await NotionImporterTable.getItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
    });

    expect(importItem).toMatchObject({
        status: {type: "UploadPending"},
        importZipSize: notionImportMaxZipSize,
    });
});
