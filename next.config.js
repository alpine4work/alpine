"use strict";

const path = require("path");
const {createVanillaExtractPlugin} = require("@vanilla-extract/next-plugin");

/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        appDir: true,
    },

    poweredByHeader: false,
    reactStrictMode: true,
    swcMinify: true,

    typescript: {
        // We run TypeScript as a part of CI. We don't need to run it again on build.
        ignoreBuildErrors: true,
    },

    eslint: {
        dirs: ["pages", "admin", "client", "server", "shared"],
        // We run eslint as a part of CI. We don't need to run it again on build.
        ignoreDuringBuilds: true,
    },

    webpack(config, {webpack, isServer}) {
        // Next.js shouldn’t compile `.test.ts` files. If it tries to that might
        // mean we have an incorrect import.
        config.plugins.push(
            new webpack.IgnorePlugin({
                resourceRegExp: /\.test\.(tsx|ts|js|jsx|mjs)$/,
            }),
        );

        // If we are building the client, don't accidentally bundle files in the
        // server directory.
        if (!isServer) {
            config.plugins.push(
                new webpack.IgnorePlugin({
                    checkResource(resource, context) {
                        if (!resource.includes("/server/")) {
                            return false;
                        }
                        return path.resolve(context, resource).startsWith(`${__dirname}/server`);
                    },
                }),
            );
        }

        return config;
    },
};

const withVanillaExtract = createVanillaExtractPlugin();

module.exports = withVanillaExtract(nextConfig);
