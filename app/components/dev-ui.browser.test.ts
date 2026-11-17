import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";

describe("DevUI browser bundle", () => {
  it("does not include the server database in the component's dependency graph", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      resolve: { alias: { "~": resolve("app") } },
      build: {
        write: false,
        lib: { entry: "app/components/dev-ui.tsx", formats: ["es"] },
        rollupOptions: {
          external: (id) =>
            !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("~"),
        },
      },
    });
    const bundles = (Array.isArray(result)
      ? result
      : [result]) as Rollup.RollupOutput[];
    const modules = bundles.flatMap((bundle) =>
      bundle.output.flatMap((output) =>
        output.type === "chunk" ? Object.keys(output.modules) : []
      )
    );

    expect(modules).not.toContain(resolve("app/db/index.ts"));
  });
});
