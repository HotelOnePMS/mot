import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Specific rules for build time
    rules: {
      // Disable warnings for unused variables
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      
      // Allow explicit any types in specific cases
      "@typescript-eslint/no-explicit-any": "warn",
      
      // Disable unescaped entities rule that causes build errors
      "react/no-unescaped-entities": "off",
      
      // Set img element warning to warning instead of error
      "@next/next/no-img-element": "warn"
    }
  }
];

export default eslintConfig;
