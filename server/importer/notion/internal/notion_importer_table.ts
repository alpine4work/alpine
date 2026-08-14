import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {NotionImportItemSchema} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Table for tracking Notion imports.
 */
export const NotionImporterTable = DynamoTableSchema.new({
    name: "NotionImporter",
    partitions: [
        /**
         * Tracks individual Notion import operations. Each import represents a user
         * uploading a Notion zip export file.
         */
        {
            name: "Import",
            partitionKeyAttributes: {
                notionImportId: DynamoKeyAttributeSchema.id<NotionImportId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: NotionImportItemSchema,
                },
            ],
        },
    ],
});

/**
 * Index for querying all imports in a space.
 */
export const SpaceNotionImportsIndex = NotionImporterTable.addIndex({
    name: "SpaceNotionImports",
    itemTypes: [{partitionType: "Import", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    sortKeyAttributes: {
        notionImportId: DynamoKeyAttributeSchema.id<NotionImportId>(),
    },
});

export type NotionImportItem = DynamoTableItemType<
    typeof NotionImporterTable,
    "Import",
    "Attributes"
>;
