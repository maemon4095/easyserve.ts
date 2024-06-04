import * as esbuild from "./deps/esbuild.ts";
import * as path from "./deps/path.ts";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader";
import loaderOverride from "./plugins/loaderOverride.ts";

const mimeTable: { [ext: string]: string | undefined; } = {
    ".css": "text/css",
    ".js": "text/javascript"
};

type Options = {
    denoConfigPath?: string;
} & Omit<esbuild.BuildOptions, "format" | "metafile" | "bundle" | "entryPoints" | "jsx" | "outfile">;

export async function serve(entryPoint: string, options?: Options) {
    const { denoConfigPath, outdir: outdirOpt, ...esbuildConfig } = options ?? {};
    const denoConfigText = await (denoConfigPath && Deno.readTextFile(denoConfigPath));
    const denoConfig = denoConfigText !== undefined ? JSON.parse(denoConfigText) : undefined;
    const { compilerOptions } = denoConfig ?? {};
    const outdir = outdirOpt ?? "./dist";
    const loaderOverridePlugin = (() => {
        const loader = options?.loader ?? { ".css": "css", ".module.css": "local-css" };
        if (loader === undefined) return [];
        return [loaderOverride({ importMap: denoConfig?.imports ?? {}, loader })];
    })();
    const context = await esbuild.context({
        ...esbuildConfig,
        outdir,
        entryPoints: [entryPoint],
        bundle: true,
        metafile: true,
        format: "esm",
        jsx: compilerOptions?.jsxImportSource ? "automatic" : "transform",
        jsxFactory: compilerOptions?.jsxFactory,
        jsxFragment: compilerOptions?.jsxFragmentFactory,
        jsxImportSource: compilerOptions?.jsxImportSource,
        plugins: [
            ...(options?.plugins ?? []),
            catchData(),
            catchEntry(),
            ...loaderOverridePlugin,
            ...denoPlugins({ "configPath": denoConfigPath }),
            generateIndexFile(),
        ]
    });

    await context.watch();
    const { host, port } = await context.serve({ servedir: outdir });
    const hostname = host === "0.0.0.0" ? "localhost" : host;
    console.log(`Serving http://${hostname}:${port}`);
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
                    const p = path.isAbsolute(args.path)
                        ? args.path
                        : path.join(args.resolveDir, args.path);
                    return {
                        path: p
                    };
                }
                return undefined;
            });
        }
    };
}

function catchData(): esbuild.Plugin {
    return {
        "name": "data",
        setup(build) {
            build.onResolve({ filter: /^data:.*$/ }, args => {
                return {
                    path: args.path,
                    external: true
                };
            });
        }
    };
}