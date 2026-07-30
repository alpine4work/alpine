import {meta as blogPostMeta} from "~/app/routes/blog.$slug.js";
import {meta as documentationMeta} from "~/app/routes/docs.$.js";
import {meta as documentationApiMeta} from "~/app/routes/docs.api.$.js";
import {meta as documentationApiIndexMeta} from "~/app/routes/docs.api._index.js";
import {meta as documentationApiSchemaMeta} from "~/app/routes/docs.api.schemas.$name.js";

const routeMetaFunctions: Array<{
    name: string;
    meta: (args: {data: undefined}) => Array<unknown>;
}> = [
    {name: "blog post", meta: blogPostMeta},
    {name: "documentation page", meta: documentationMeta},
    {name: "API page", meta: documentationApiMeta},
    {name: "API index", meta: documentationApiIndexMeta},
    {name: "API schema", meta: documentationApiSchemaMeta},
];

describe("documentation route metadata", () => {
    test.each(routeMetaFunctions)("$name returns safe metadata without loader data", ({meta}) => {
        expect(meta({data: undefined})).toEqual([
            {name: "robots", content: "noindex"},
            {title: "Alpine"},
        ]);
    });
});
