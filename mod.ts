import * as esbuild from "https://deno.land/x/esbuild@v0.21.2/mod.js";
import * as path from "https://deno.land/std@0.224.0/path/mod.ts";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader";

const mimeTable: { [ext: string]: string | undefined; } = {
    ".css": "text/css",
    ".js": "text/javascript"
};

type Options = {
    denoConfigPath?: string;
} & Omit<esbuild.BuildOptions, "format" | "metafile" | "bundle" | "entryPoints" | "jsx">;

export async function serve(entryPoint: string, options?: Options) {
    const { denoConfigPath, ...esbuildConfig } = options ?? {};
    const denoConfigText = await (denoConfigPath && Deno.readTextFile(denoConfigPath));
    const denoConfig = denoConfigText !== undefined ? JSON.parse(denoConfigText) : undefined;
    const { compilerOptions } = denoConfig ?? {};
    const context = await esbuild.context({
        ...esbuildConfig,
        entryPoints: [entryPoint],
        bundle: true,
        metafile: true,
        format: "esm",
        jsx: "transform",
        jsxFactory: compilerOptions?.jsxFactory,
        jsxFragment: compilerOptions?.jsxFragmentFactory,
        jsxImportSource: compilerOptions?.jsxImportSource,
        plugins: [
            ...(options?.plugins ?? []),
            catchEntry(),
            cssLoader(),
            ...denoPlugins({ "configPath": options?.denoConfigPath }),
            generateIndexFile(),
        ]
    });

    await context.watch();
    const { host, port } = await context.serve({ servedir: options?.outdir });
    const hostname = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Serving http://${hostname}:${port}`);
}

function cssLoader(): esbuild.Plugin {
    return {
        name: "css",
        setup(build) {
            build.onResolve({ filter: /^.*\.module\.css$/ }, args => {
                const p = path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path);
                return {
                    path: p,
                    namespace: "css-module"
                };
            });

            build.onResolve({ filter: /^.*\.css$/ }, args => {
                const p = path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path);
                return {
                    path: p,
                    namespace: "css"
                };
            });

            build.onLoad({ filter: /.*/, namespace: "css" }, async args => {
                const contents = await Deno.readTextFile(args.path);
                return { contents, loader: "css" };
            });

            build.onLoad({ filter: /.*/, namespace: "css-module" }, async args => {
                const contents = await Deno.readTextFile(args.path);
                return { contents, loader: "local-css" };
            });
        }
    };
}

function generateIndexFile(): esbuild.Plugin {
    return {
        "name": "generateIndexFile",
        setup(build: esbuild.PluginBuild) {
            const outdir = build.initialOptions.outdir!;
            const indexFilePath = path.join(outdir, "index.html");

            build.onEnd(async args => {
                const meta = args.metafile;
                if (meta === undefined) return;
                const outdir = build.initialOptions.outdir!;
                const { scripts, stylesheets } = collectOutputs(meta);
                const scriptTags = scripts
                    .map(e => path.relative(outdir, e))
                    .map(e => `<script type="module" src=${JSON.stringify(e)}></script>`);
                const stylesheetTags = stylesheets
                    .map(e => path.relative(outdir, e))
                    .map(e => `<link rel="stylesheet" href=${JSON.stringify(e)}>`);

                await Deno.mkdir(outdir, { recursive: true });
                await Deno.writeTextFile(indexFilePath,
                    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${stylesheetTags}
${scriptTags}
<script defer>new EventSource('/esbuild').addEventListener('change', () => location.reload());</script>
</head>
<body>
</body>
</html>`);
            });
        }
    };
}

function collectOutputs(meta: esbuild.Metafile) {
    const extPat = /^.*?(?<ext>(\.[^/\\\.]+)*)$/;
    const scripts: string[] = [];
    const stylesheets: string[] = [];

    for (const [file] of Object.entries(meta.outputs)) {
        const match = file.match(extPat);
        const ext = match?.groups?.ext ?? "";
        const mime = mimeTable[ext];

        switch (mime) {
            case "text/javascript": {
                scripts.push(file);
                break;
            }
            case "text/css": {
                stylesheets.push(file);
                break;
            }
        }
    }
    return {
        stylesheets, scripts
    };
}

function catchEntry(): esbuild.Plugin {
    return {
        "name": "catch entry",
        setup(build: esbuild.PluginBuild) {
            build.onResolve({ filter: /.*/ }, args => {
                if (args.kind === "entry-point") {
                    return {
                        "path": args.path,
                    };
                }
                return undefined;
            });
        }
    };
}