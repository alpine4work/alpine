import {MetaArgs, MetaDescriptor} from "@remix-run/react";
import {Location, Params} from "react-router-dom";
import {getLoaderDataWithSchema} from "~/client/web/remix/get_loader_data_with_schema.js";
import {isLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {metaDefaultTitle, metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Create a new meta function that can use data serialized by a `loader` returning
 * `jsonWithSchema()`.
 *
 * Also handles errors and automatically appends our product name to browser
 * titles.
 */
export function createMetaFunction<Data>(
    schema: Schema<Data>,
    meta: (args: {
        data: Data;
        // NOTE(calebmer): Returned data is potentially null to force consumer code to
        // handle the error case. Though it is unclear if the error case ever happens? We
        // know top-level `data` may be undefined in a meta function.
        getParentData: <ParentData>(
            parentRouteId: string,
            schema: Schema<ParentData>,
        ) => ParentData | null;
        params: Params;
        location: Location;
    }) => Array<MetaDescriptor>,
) {
    return (args: MetaArgs<any>): Array<MetaDescriptor> => {
        // If there is an error, data will sometimes be undefined and sometimes be an
        // `Error` object. In that case return some default meta.
        if (!args.data || args.data instanceof Error) {
            return [
                // Ask Google to not index error pages.
                {name: "robots", content: "noindex"},
                {title: metaDefaultTitle},
            ];
        }

        // If we're still loading some data, we can't render the proper HTML title. The
        // `<Root>` component re-renders when loading indicator loader data resolves which
        // causes the meta function to re-run and show the right value.
        if (
            args.matches.some(
                ({data}) =>
                    isLoadingIndicatorLoaderData(data) &&
                    data.promise.getStateWithoutListening().status !== "fulfilled",
            )
        ) {
            return [
                // Ask Google to not index loading or error pages.
                {name: "robots", content: "noindex"},
                {title: metaDefaultTitle},
            ];
        }

        const data = getLoaderDataWithSchema(schema, args.data);

        let descriptors = meta({
            data,
            getParentData: (parentRouteId, schema) => {
                const match = args.matches.find(match => match.id === parentRouteId);
                if (!match) return null;
                return getLoaderDataWithSchema(schema, match.data as any);
            },
            params: args.params,
            location: args.location,
        });

        let hasTitleDescriptor = false;

        descriptors = descriptors.map(descriptor => {
            if (!("title" in descriptor)) return descriptor;

            hasTitleDescriptor = true;
            return {title: `${descriptor.title as string}${metaTitlePostfix}`};
        });

        if (!hasTitleDescriptor) {
            descriptors.unshift({title: metaDefaultTitle});
        }

        // Ask Google to not index error pages.
        descriptors.unshift({name: "robots", content: "noindex"});

        return descriptors;
    };
}
