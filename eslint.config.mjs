import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * M-RT-17/18/19: no-direct-prisma-domain-table
 * Forbids `db.<table>` reads outside the runtime for migrated capabilities.
 * ERROR for refund (M-RT-19), WARN for payment (M-RT-18 re-migration is incremental).
 */
const READ_ERROR_TABLES = ["refund"];
const READ_WARN_TABLES = ["payment"];
const READ_ALLOWED_PREFIXES = [
  "src/runtime/", "src/lib/db", "src/lib/auth", "src/app/api/auth",
  "src/services/", "scripts/",
];

const noDirectPrismaReadRule = {
  meta: {
    type: "problem",
    docs: { description: "Forbid direct Prisma reads outside the runtime (M-RT-17/18/19)." },
    schema: [],
    messages: {
      noDirectPrisma: "M-RT-17/18/19: `db.{{table}}` is forbidden in pages/API routes. Use the read-model façade (`{{table}}ReadModel`) or `runtime.{{table}}s` instead.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    if (READ_ALLOWED_PREFIXES.some((p) => filename.includes(`/my-project/${p}`) || filename.startsWith(p))) return {};
    return {
      MemberExpression(node) {
        if (node.object?.type === "MemberExpression" && node.object.object?.type === "Identifier" && node.object.object.name === "db" && node.object.property?.type === "Identifier") {
          const table = node.object.property.name;
          if (READ_ERROR_TABLES.includes(table) || READ_WARN_TABLES.includes(table)) {
            context.report({ node, messageId: "noDirectPrisma", data: { table } });
          }
        }
      },
    };
  },
};

/**
 * M-RT-21: no-direct-prisma-write
 * Forbids `db.<table>.create()`, `.update()`, `.delete()`, `.upsert()`,
 * `.createMany()`, `.updateMany()`, `.deleteMany()` outside the runtime,
 * migration, seed, and test directories.
 *
 * Every financial mutation must go through RuntimeDispatcher.dispatch().
 */
const WRITE_METHODS = ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany", "createManyAndReturn", "updateManyAndReturn", "deleteManyAndReturn"];
const WRITE_ALLOWED_PREFIXES = [
  "src/runtime/", "src/lib/db", "src/lib/auth", "src/app/api/auth",
  "src/services/", "scripts/", "tests/", "certification/",
];

const noDirectPrismaWriteRule = {
  meta: {
    type: "problem",
    docs: { description: "Forbid direct Prisma writes outside the runtime; all mutations must go through RuntimeDispatcher (M-RT-21)." },
    schema: [],
    messages: {
      noDirectPrismaWrite: "M-RT-21: `db.{{table}}.{{method}}()` is forbidden. All financial mutations must go through `runtime.dispatcher.dispatch(command)`. Direct Prisma writes bypass the Invariant Engine and Command Registry.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    if (WRITE_ALLOWED_PREFIXES.some((p) => filename.includes(`/my-project/${p}`) || filename.startsWith(p))) return {};
    return {
      CallExpression(node) {
        // Match: db.<table>.<writeMethod>( — e.g., db.payment.create(
        const callee = node.callee;
        if (callee?.type === "MemberExpression" && callee.object?.type === "MemberExpression" && callee.object.object?.type === "Identifier" && callee.object.object.name === "db" && callee.property?.type === "Identifier") {
          const method = callee.property.name;
          if (WRITE_METHODS.includes(method)) {
            context.report({ node, messageId: "noDirectPrismaWrite", data: { table: callee.object.property?.name ?? "?", method } });
          }
        }
      },
    };
  },
};

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  plugins: {
    "payswap-read-models": {
      rules: {
        "no-direct-prisma-domain-table": noDirectPrismaReadRule,
        "no-direct-prisma-write": noDirectPrismaWriteRule,
      },
    },
  },
  rules: {
    // M-RT-17/18/19: enforce read-model façade consumption.
    "payswap-read-models/no-direct-prisma-domain-table": "warn",
    // M-RT-21: enforce RuntimeDispatcher for all writes (warn — incremental migration).
    "payswap-read-models/no-direct-prisma-write": "warn",
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
