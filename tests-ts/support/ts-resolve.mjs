/**
 * Test-only module resolve hook (plan D41). Never imported by app code.
 *
 * Why it exists: node:test runs frontend/lib/server/*.ts directly under
 * Node's type stripping, but those modules are written for the Next.js
 * bundler:
 *   - they `import "server-only"`, a marker package that throws outside a
 *     React Server Components build;
 *   - they use extensionless relative value imports ("./firebase-admin",
 *     "../tracking"), which Node's ESM resolver does not complete.
 * This hook maps "server-only" to an empty module and completes extensionless
 * relative imports made from files under <repo>/frontend/ to .ts, .tsx or
 * /index.ts. Everything else goes to Node's default resolver.
 *
 * Run with --experimental-transform-types, because documents.ts uses
 * TypeScript constructor parameter properties, which plain type stripping
 * rejects. Example:
 *   node --experimental-transform-types --import ./tests-ts/support/ts-resolve.mjs --test <file>
 */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTEND_DIR_URL = new URL("../../frontend/", import.meta.url).href;
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts"];

function hasExtension(specifier) {
  const last = specifier.split("/").pop() ?? "";
  return last.includes(".") && last !== "." && last !== "..";
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,", shortCircuit: true };
    }

    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const parentURL = context.parentURL;
    if (
      isRelative &&
      !hasExtension(specifier) &&
      typeof parentURL === "string" &&
      parentURL.startsWith(FRONTEND_DIR_URL)
    ) {
      const base = fileURLToPath(new URL(specifier, parentURL));
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = base + suffix;
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
