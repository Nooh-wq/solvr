import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  {
    // src/core/* is an extraction candidate (see AGENTS.md "src/core/* is
    // an extraction candidate — hard import rule" and boundary doc §7.19
    // M-core-extraction). To keep the extraction cheap, core code must
    // not depend on app-shell code (src/lib, src/app). Adjacent modules
    // inside src/core/* and third-party packages are the only allowed
    // imports. The dependency arrow is app → lib → core, never back.
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/*", "@/lib/**", "@/app/*", "@/app/**"],
              message:
                "src/core/* MUST NOT import from src/lib/* or src/app/*. Extraction invariant — see AGENTS.md and boundary doc §7.19. Move the shared piece into src/core/* first.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
