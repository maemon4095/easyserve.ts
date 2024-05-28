import * as esbuild from "../../deps/esbuild.ts";
import * as path from "../../deps/path.ts";
import { isURL } from "./isURL.ts";

export type ImportMap = { [prefix: string]: string; };
export function createResolverFromImportMap(importMapOrPath: string | ImportMap) {
    let importMap: ImportMap = {};
    let importMapPrefix = "";
    if (typeof importMapOrPath === "string") {
        const raw = Deno.readFileSync(importMapOrPath);
        const text = new TextDecoder().decode(raw);
        const map = JSON.parse(text) as { imports: ImportMap; };

        importMapPrefix = path.dirname(importMapOrPath);
        importMap = { ...importMap, ...(map.imports) };
    }

    if (typeof importMapOrPath === "object") {
        importMap = { ...importMap, ...importMapOrPath };
    }

    return (p: string) => {
        for (const [pref, rep] of Object.entries(importMap)) {
            if (!p.startsWith(pref)) continue;

            return path.join(importMapPrefix, rep, p.slice(pref.length));
        }
    };
}

export function defaultResolve(args: esbuild.OnResolveArgs) {
    if (isURL(args.path)) {
        return args.path;
    }
    if (path.isAbsolute(args.path)) {
        return args.path;
    }
    if (args.importer) {
        return path.join(path.dirname(args.importer), args.path);
    } else {
        return path.join(args.resolveDir, args.path);
    }
}