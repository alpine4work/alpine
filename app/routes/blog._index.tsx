import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedBlogHomePage} from "~/app/docs/load_generated_blog.server.js";
import {BlogHomePage} from "~/client/web/docs/blog.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";

/**
 * Build metadata for the blog home route.
 */
export function meta() {
    return [
        {title: `Alpine Blog${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
    ];
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
