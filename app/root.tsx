import type {MetaFunction} from "@remix-run/cloudflare";
import {Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration} from "@remix-run/react";

export const meta: MetaFunction = () => ({
    charset: "utf-8",
    title: "Cyberworlds",
    viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
});

export default function App() {
    return (
        <html lang="en">
            <head>
                <Meta />
                <Links />
            </head>
            <body>
                <Outlet />
                <ScrollRestoration />
                <Scripts />
                <LiveReload />
            </body>
        </html>
    );
}
