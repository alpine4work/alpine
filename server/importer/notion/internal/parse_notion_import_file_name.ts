/**
 * Matches Notion file names: `Title <32hexchars>.md` or `Title <32hexchars>.csv`
 */
const notionImportFileNamePattern = /^(.+)\s([0-9a-f]{32})\.(md|csv)$/;

export interface NotionImportFileName {
    /** The document/database title extracted from the file name. */
    title: string;
    /** The 32-character hex Notion ID. */
    notionId: string;
    /** The file extension without the dot (md or csv). */
    extension: "md" | "csv";
}

/**
 * Parses Notion export file names which follow the pattern:
 * `Title <32hexchars>.md` or `Title <32hexchars>.csv`
 *
 * @see README.md "Notion ID Formats" section for details on the 32-char hex ID
 * format. @see README.md "Document Types" section for how pages and databases use
 * this naming.
 */
export function parseNotionImportFileName(fileName: string): NotionImportFileName | null {
    const match = fileName.match(notionImportFileNamePattern);
    if (!match) return null;

    return {
        title: match[1]!,
        notionId: match[2]!,
        extension: match[3] as "md" | "csv",
    };
}
