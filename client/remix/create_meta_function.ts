import {HtmlMetaDescriptor, MetaFunction} from "@remix-run/server-runtime";
import {Location, Params} from "react-router-dom";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema";
import {metaDefaultTitle, metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {Schema} from "~/shared/schema/schema";

/**
 * Create a new meta function that can use data serialized by a `loader`
 * returning `jsonWithSchema()`.
 *
 * Also handles errors and automatically appends our product name to
 * browser titles.
 */
export function createMetaFunction<Data>(
    schema: Schema<Data>,
    meta: (args: {
        data: Data;
        // NOTE(calebmer): Returned data is potentially null to force consumer code to
        // handle the error case. Though it is unclear if the error case ever happens?
        // We know top-level `data` may be undefined in a meta function.
        getParentsData: <ParentData>(
            parentRouteId: string,
            schema: Schema<ParentData>,
        ) => ParentData | null;
        params: Params;
        location: Location;
    }) => HtmlMetaDescriptor,
): MetaFunction {
    return args => {
        // If there is an error, data will sometimes be undefined and sometimes be an
        // `Error` object. In that case return some default meta.
        if (!args.data || args.data instanceof Error) {
            return {
                title: metaDefaultTitle,
                // Ask Google to not index error pages.
                robots: "noindex",
            };
        }

        const data = getLoaderDataWithSchema(schema, args.data);
        const metaDescriptor = meta({
            data,
            getParentsData: (parentRouteId, schema) =>
                args.parentsData[parentRouteId] &&
                !(args.parentsData[parentRouteId] instanceof Error)
                    ? getLoaderDataWithSchema(schema, args.parentsData[parentRouteId])
                    : null,
            params: args.params,
            location: args.location,
        });

        return {
            ...metaDescriptor,
            // Append our standard postfix to the title.
            title: metaDescriptor.title
                ? `${metaDescriptor.title}${metaTitlePostfix}`
                : metaDefaultTitle,
        };
    };
}
