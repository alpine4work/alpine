import {ComponentType, useMemo} from "react";
import {assert} from "~/shared/helpers/control/assert";
import {ObjectSchema} from "~/shared/schema/schema";

export type PageComponent<Query, Props> =
    // Component props are `never` since Next.js is responsible for rendering this
    // component. We should not manually render the component ourselves. `never`
    // prevent that.
    ComponentType<never> & {
        querySchema: ObjectSchema<Query>;
        propsSchema: ObjectSchema<Props>;
    };

/**
 * A helper for creating Next.js pages in our codebase.
 *
 * Uses `Schema` for declaring the types of data in our query and for declaring the
 * type of props. We want to use `Schema` to declare the types of props so that we can
 * serialize/deserialize more interesting objects than JSON over the network.
 */
export function createPageComponent<Query, Props>({
    query: querySchema,
    props: propsSchema,
    component: Component,
}: {
    query: ObjectSchema<Query>;
    props: ObjectSchema<Props>;
    component: ComponentType<Props>;
}): PageComponent<Query, Props> {
    function Page(props: {deserializedPropsRef: {[deserializedPropsRefCurrentSymbol]?: Props}}) {
        const actualProps = useMemo(() => {
            // When executing outside a browser context we expect `getServerSideProps` to
            // run in the same process as our component. So we can use the deserialized
            // object from the `getServerSideProps` call directly without needing to
            // deserialize again here.
            if (typeof window === "undefined") {
                assert(
                    props.deserializedPropsRef[deserializedPropsRefCurrentSymbol],
                    "Expected to have the deserialized props object on the server",
                );
            }

            // When executing in the browser, we need to deserialize the props object. To
            // make sure we only deserialize once (even in React strict mode) we stash the
            // deserialized object in the same ref property the server used.

            if (props.deserializedPropsRef[deserializedPropsRefCurrentSymbol])
                return props.deserializedPropsRef[deserializedPropsRefCurrentSymbol];

            const deserializedProps = propsSchema.deserializeInto(props, {});
            props.deserializedPropsRef[deserializedPropsRefCurrentSymbol] = deserializedProps;
            return props.deserializedPropsRef[deserializedPropsRefCurrentSymbol];
        }, [props]);

        return <Component {...(actualProps as any)} />;
    }

    return Object.assign(Page, {querySchema, propsSchema});
}

/**
 * An internal implementation detail of our page creation helper. Should only
 * be used by the helper which creates a `getServerSideProps` function.
 *
 * This needs to be a symbol so that it's not enumerable and does not get
 * serialized over the network.
 */
export const deserializedPropsRefCurrentSymbol = Symbol("current");
