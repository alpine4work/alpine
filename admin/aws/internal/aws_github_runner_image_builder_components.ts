import {RunnerImageComponent, RunnerVersion} from "@cloudsnorkel/cdk-github-runners";

export function awsGithubRunnerImageBuilderComponents({
    extraAptDependencies = [],
    noInstallRecommends = [],
}: {
    extraAptDependencies?: Array<string>;
    noInstallRecommends?: Array<string>;
} = {}) {
    return [
        RunnerImageComponent.requiredPackages(),
        RunnerImageComponent.runnerUser(),
        RunnerImageComponent.git(),
        RunnerImageComponent.githubCli(),
        RunnerImageComponent.awsCli(),
        RunnerImageComponent.docker(),
        RunnerImageComponent.githubRunner(RunnerVersion.latest()),

        // Installs:
        //
        // - `zstd` for better GitHub `actions/cache` compression/decompression
        //   performance.
        // - `build-essential` which includes `gcc` and `make` among other common build
        //   tools.
        // - `nodejs` since we need to run `aws_github_runners_bazel_remote_cache.cjs`
        //   before anything from Bazel.
        RunnerImageComponent.custom({
            name: "AptGetInstall",
            commands: [
                `apt-get install -y ${Array.from(
                    new Set([
                        // Better GitHub `actions/cache` compression/decompression performance.
                        "zstd",
                        // Includes `gcc` and `make` among other common build tools. Necessary for building
                        // some npm packages.
                        "build-essential",
                        // LLVM's linker. When Bazel auto-configures the CC toolchain it looks for `lld`
                        // first, falling back to `gold` (from binutils). `gold` is deprecated and `rustc`
                        // warns when it's used. Installing `lld` makes Bazel prefer it, which is also
                        // faster.
                        "lld",
                        // We need run a small `aws_github_runners_bazel_remote_cache.cjs` server to enable
                        // remote caching before anything is built by Bazel.
                        "nodejs",

                        ...extraAptDependencies,
                    ]),
                ).join(" ")}`,
                ...(noInstallRecommends.length > 0
                    ? [
                          `apt-get install -y --no-install-recommends ${Array.from(
                              new Set(noInstallRecommends),
                          ).join(" ")}`,
                      ]
                    : []),
            ],
        }),
    ];
}
