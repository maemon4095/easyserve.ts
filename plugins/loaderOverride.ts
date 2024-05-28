import * as esbuild from "../deps/esbuild.ts";
import { ImportMap, createResolverFromImportMap, defaultResolve } from "./util/resolver.ts";

export default function loaderOverride(options: { importMap?: string | ImportMap, loader: { [ext: `.${string}`]: esbuild.Loader; }; }): esbuild.Plugin {
    const { importMap, loader } = options;
    const importMapResolver = createResolverFromImportMap(importMap ?? {});
    const filter = (() => {
        const extensions = Object.keys(loader);
        if (extensions.length === 0) {
            return /^\0$/; // never match
        }

        let pattern = "^.*(";
        let first = true;
        for (const ext of extensions) {
            if (first) {
                first = false;
            } else {
                pattern += "|";
            }
            pattern = `${pattern}\\${ext}`;
        }
        pattern += ")$";
        return new RegExp(pattern);
    })();

    const nsExternal = `${loaderOverride.name}-external`;;
    const nsLocal = `${loaderOverride.name}-local`;;

    const isURL = (() => {
        const pat = /^(http|https):\/\/.*$/;
        return (p: string) => pat.test(p);
    })();

    return {
        name: loaderOverride.name,
        setup(build) {
            build.onResolve({ filter }, args => {
                const path = importMapResolver(args.path) ?? defaultResolve(args);
                return {
                    path,
                    namespace: isURL(path) ? nsExternal : nsLocal,
                };
            });

            build.onLoad({ filter: /.*/, namespace: nsLocal }, async args => {
                const match = args.path.match(filter)!;
                const ext = match[1] as `.${string}`;
                const contents = await Deno.readFile(args.path);
                return {
                    contents,
                    loader: loader[ext]
                };
            });

            build.onLoad({ filter: /.*/, namespace: nsExternal }, async args => {
                const match = args.path.match(filter)!;
                const ext = match[1] as `.${string}`;
                const response = await fetch(args.path);
                const buf = await response.arrayBuffer();
                return {
                    contents: new Uint8Array(buf),
                    loader: loader[ext]
                };
            });
        }
    };
}