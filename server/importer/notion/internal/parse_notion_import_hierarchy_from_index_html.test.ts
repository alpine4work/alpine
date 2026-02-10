/* eslint-disable cyberworlds/string-quotes -- Tests need straight quotes for HTML content */
import {strToU8} from "fflate";

import {parseNotionImportHierarchyFromIndexHtml} from "~/server/importer/notion/internal/parse_notion_import_hierarchy_from_index_html.js";

describe("parseNotionImportHierarchyFromIndexHtml", () => {
    function makeFiles(indexHtml: string): Record<string, Uint8Array> {
        return {
            "export/index.html": strToU8(indexHtml),
        };
    }

    test("returns empty result when no index.html exists", () => {
        const result = parseNotionImportHierarchyFromIndexHtml({}, new Map());

        expect(result).toEqual({
            relationships: [],
            parentOnlyRelationships: [],
            teamspaceForPath: new Map(),
            csvOnlyDatabaseChildren: new Map(),
            rootLevelCsvDatabases: new Map(),
        });
    });

    test("returns empty result when no root ul found", () => {
        const html = `<html><body><div>No ul here</div></body></html>`;
        const files = makeFiles(html);

        const result = parseNotionImportHierarchyFromIndexHtml(files, new Map());

        expect(result.relationships).toEqual([]);
    });

    test("extracts parent-child relationships from nested ul elements", () => {
        const parentId = "aaaabbbbccccddddeeeeffffgggghhh1";
        const childId = "aaaabbbbccccddddeeeeffffgggghhh2";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${parentId}">
                        <li><a href="Parent.html">Parent</a></li>
                        <li>
                            <ul id="id::${childId}">
                                <li><a href="Child.html">Child</a></li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [parentId, `Parent ${parentId}.md`],
            [childId, `Child ${childId}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.relationships).toEqual([
            {
                parentPath: `Parent ${parentId}.md`,
                childPath: `Child ${childId}.md`,
            },
        ]);
    });

    test("detects teamspaces when all depth-1 items have anchors without href", () => {
        const teamspaceId = "teamspace00000000000000000000001";
        const docId = "aaaabbbbccccddddeeeeffffgggghhh1";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${teamspaceId}">
                        <li><a>Team A</a></li>
                        <li>
                            <ul id="id::${docId}">
                                <li><a href="Doc.html">Doc</a></li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([[docId, `Doc ${docId}.md`]]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.teamspaceForPath.get(`Doc ${docId}.md`)).toBe(teamspaceId);
    });

    test("handles CSV-only databases and tracks children", () => {
        const csvId = "csvdbcsvdbcsvdbcsvdbcsvdbcsvdb01";
        const childId = "childchildchildchildchildchild01";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${csvId}.csv">
                        <li><a href="Database.csv">Database</a></li>
                        <li>
                            <ul id="id::${childId}">
                                <li><a href="Row.html">Row</a></li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [csvId, `Database ${csvId}.csv`],
            [childId, `Row ${childId}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.csvOnlyDatabaseChildren.get(`Database ${csvId}.csv`)).toEqual([childId]);
    });

    test("handles nested database with grandparent using parent-only relationships", () => {
        const grandparentId = "grandparentgrandparentgrandpare1";
        const csvId = "csvdbcsvdbcsvdbcsvdbcsvdbcsvdb02";
        const childId = "childchildchildchildchildchild02";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${grandparentId}">
                        <li><a href="Parent.html">Parent</a></li>
                        <li>
                            <ul id="id::${csvId}.csv">
                                <li><a href="Database.csv">Database</a></li>
                                <li>
                                    <ul id="id::${childId}">
                                        <li><a href="Row.html">Row</a></li>
                                    </ul>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [grandparentId, `Parent ${grandparentId}.md`],
            [csvId, `Database ${csvId}.csv`],
            [childId, `Row ${childId}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        // The child should have a parent-only relationship to the grandparent
        expect(result.parentOnlyRelationships).toEqual([
            {
                parentPath: `Parent ${grandparentId}.md`,
                childPath: `Row ${childId}.md`,
            },
        ]);
    });

    test("tracks root-level CSV databases with teamspace", () => {
        const teamspaceId = "teamspace00000000000000000000002";
        const csvId = "csvdbcsvdbcsvdbcsvdbcsvdbcsvdb03";
        const childId = "childchildchildchildchildchild03";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${teamspaceId}">
                        <li><a>Team A</a></li>
                        <li>
                            <ul id="id::${csvId}.csv">
                                <li><a href="Database.csv">Database</a></li>
                                <li>
                                    <ul id="id::${childId}">
                                        <li><a href="Row.html">Row</a></li>
                                    </ul>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [csvId, `Database ${csvId}.csv`],
            [childId, `Row ${childId}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.rootLevelCsvDatabases.get(`Database ${csvId}.csv`)).toEqual({
            childPaths: [`Row ${childId}.md`],
            teamspaceId,
        });
    });

    test("handles multiple children under same parent", () => {
        const parentId = "parentparentparentparentparentp1";
        const child1Id = "child1child1child1child1child1c1";
        const child2Id = "child2child2child2child2child2c2";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${parentId}">
                        <li><a href="Parent.html">Parent</a></li>
                        <li>
                            <ul id="id::${child1Id}">
                                <li><a href="Child1.html">Child 1</a></li>
                            </ul>
                        </li>
                        <li>
                            <ul id="id::${child2Id}">
                                <li><a href="Child2.html">Child 2</a></li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [parentId, `Parent ${parentId}.md`],
            [child1Id, `Child 1 ${child1Id}.md`],
            [child2Id, `Child 2 ${child2Id}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.relationships).toEqual([
            {parentPath: `Parent ${parentId}.md`, childPath: `Child 1 ${child1Id}.md`},
            {parentPath: `Parent ${parentId}.md`, childPath: `Child 2 ${child2Id}.md`},
        ]);
    });

    test("handles UUIDs with dashes by normalizing them", () => {
        const parentId = "aaaa-bbbb-cccc-dddd-eeee-ffff-1111-2222";
        const parentIdNormalized = "aaaabbbbccccddddeeeeffff11112222";
        const childId = "3333-4444-5555-6666-7777-8888-9999-0000";
        const childIdNormalized = "33334444555566667777888899990000";

        const html = `<html><body>
            <ul id="id::workspace">
                <li>
                    <ul id="id::${parentId}">
                        <li><a href="Parent.html">Parent</a></li>
                        <li>
                            <ul id="id::${childId}">
                                <li><a href="Child.html">Child</a></li>
                            </ul>
                        </li>
                    </ul>
                </li>
            </ul>
        </body></html>`;
        const files = makeFiles(html);
        const notionIdToPath = new Map([
            [parentIdNormalized, `Parent ${parentIdNormalized}.md`],
            [childIdNormalized, `Child ${childIdNormalized}.md`],
        ]);

        const result = parseNotionImportHierarchyFromIndexHtml(files, notionIdToPath);

        expect(result.relationships).toEqual([
            {
                parentPath: `Parent ${parentIdNormalized}.md`,
                childPath: `Child ${childIdNormalized}.md`,
            },
        ]);
    });
});
