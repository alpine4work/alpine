import {GetServerSideProps, GetServerSidePropsContext, GetServerSidePropsResult} from "next";
import {ParsedUrlQuery} from "querystring";
import {
    PageComponent,
    deserializedPropsRefCurrentSymbol,
    // Safe since we need to execute client code on the server for
    // server-side rendering.
    // eslint-disable-next-line import/no-restricted-paths
} from "~/client/helpers/pages/create-page-component";
import {
    convertUrlSearchParamCaseToIdentifier,
    isUrlSearchParamCase,
} from "~/server/helpers/pages/url-search-param-case";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {SchemaSerializedObjectValue} from "~/shared/schema/schema";

/**
 * Creates a Next.js `getServerSideProps` function from a page component
 * created by `createPageComponent`.
 *
 * This function makes sure the returned props object adheres to the format
 * expected by `createPageComponent`.
 */
export function createGetServerSideProps<Query, Props extends {[key: string]: any}>(
    PageComponent: PageComponent<Query, Props>,
    getProps: (
        context: Omit<GetServerSidePropsContext, "query"> & {query: Query},
    ) => Promise<GetServerSidePropsResult<BlockInference<Props>>>,
): GetServerSideProps<SchemaSerializedObjectValue> {
    const getServerSideProps: GetServerSideProps<SchemaSerializedObjectValue> = async context => {
        const serializedQuery: ParsedUrlQuery = {};

        for (const [queryKey, queryValue] of Object.entries(context.query)) {
            if (!isUrlSearchParamCase(queryKey)) continue;
            serializedQuery[convertUrlSearchParamCaseToIdentifier(queryKey)] = queryValue;
        }

        const query = PageComponent.querySchema.deserialize(serializedQuery);
        (context as any).query = query;

        const result = await getProps(context as any);
        if (!("props" in result)) return result;

        const props = await result.props;

        const serializedProps = PageComponent.propsSchema.serialize(props as Props);

        // The page component returned by `createPageComponent` depends on this
        // property on the server so it doesn't need an extra deserialization step.
        (serializedProps as any).deserializedPropsRef = {
            [deserializedPropsRefCurrentSymbol]: props,
        };

        return {props: serializedProps};
    };

    return getServerSideProps;
}
