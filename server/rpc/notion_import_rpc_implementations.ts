import {cancelNotionImport} from "~/server/importer/notion/cancel_notion_import.js";
import {createNotionImport} from "~/server/importer/notion/create_notion_import.js";
import {finishedNotionImportUpload} from "~/server/importer/notion/finished_notion_import_upload.js";
import {
    getAllNotionImportsForSpace,
    getNotionImport,
} from "~/server/importer/notion/get_notion_import.js";
import {retryNotionImport} from "~/server/importer/notion/retry_notion_import.js";
import {startNotionImport} from "~/server/importer/notion/start_notion_import.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/notion_import_rpc_definitions.js";

export default implementRpcs(definitions, {
    createNotionImport: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            return await createNotionImport(sessionContext, {
                spaceId: input.spaceId,
                contentType: input.contentType,
                contentLength: input.contentLength,
            });
        },
    },

    startNotionImport: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            await startNotionImport(sessionContext, {
                spaceId: input.spaceId,
                notionImportId: input.notionImportId,
                teamspaceImportOptions: input.teamspaceImportOptions,
            });

            return {};
        },
    },

    finishedNotionImportUpload: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            await finishedNotionImportUpload(sessionContext, {
                spaceId: input.spaceId,
                notionImportId: input.notionImportId,
                uploadId: input.uploadId,
                parts: input.parts,
            });

            return {};
        },
    },

    getNotionImport: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const notionImport = await getNotionImport(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                notionImportId: input.notionImportId,
            });

            return {
                notionImport,
            };
        },
    },

    getAllNotionImportsForSpace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const notionImports = await getAllNotionImportsForSpace(
                context.actor.authorizeSession(),
                {spaceId: input.spaceId},
            );

            return {
                notionImports,
            };
        },
    },

    cancelNotionImport: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await cancelNotionImport(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                notionImportId: input.notionImportId,
            });

            return {};
        },
    },

    retryNotionImport: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await retryNotionImport(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                notionImportId: input.notionImportId,
            });

            return {};
        },
    },
});
