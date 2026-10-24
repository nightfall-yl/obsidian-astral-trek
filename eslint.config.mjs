import globals from "globals";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "node_modules/",
      "coverage/"
    ]
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": "warn",
      // 声明式设置 API（getSettingDefinitions）是 1.13 新特性，完整迁移属于
      // 独立重构；当前设置页为命令式构建，先关闭此建议性规则（两条相关规则）。
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/settings-tab/progressive-api": "off",
      // 本插件 UI 以中文为主，该规则会把非首词强转小写（"Sean"→"sean"、
      // "Dashboard"→"dashboard"、"UTC"→"utc"），对中文与品牌名基本是误报。
      "obsidianmd/ui/sentence-case": "off"
    }
  },
  {
    // Vitest 测试文件跑在 Node.js 上，允许使用 Node.js 内置模块。
    files: ["src/**/*.test.ts"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off"
    }
  }
);
