import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedBlogHomePage} from "~/app/docs/load_generated_blog.server.js";
import {createDocumentationMeta} from "~/app/docs/opengraph/create_documentation_meta.js";
import {BlogHomePage, blogHomeUrl} from "~/client/web/docs/blog.js";

/**
 * Build metadata for the blog home route.
 */
export function meta() {
    return createDocumentationMeta({
        type: "Blog",
        title: "Alpine Blog",
        description:
            "Ideas about better tools, calmer work, and software that keeps context together.",
        pageUrl: blogHomeUrl,
    });
}

/**
 * Load generated data for the blog home route.
 */
export async function loader() {
    return json(await loadGeneratedBlogHomePage());
}

/**
 * Render the blog home route from generated loader data.
 */
export default function BlogIndexRoute() {
    const {posts, authors, searchIndex} = useLoaderData<typeof loader>();
    return <BlogHomePage posts={posts} authors={authors} searchIndex={searchIndex} />;
}
