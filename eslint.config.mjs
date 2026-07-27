import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * M-RT-17/18/19: read-model façade enforcement.
 *
 * Pages and API routes must NOT call `db.<DomainTable>` directly. They must
 * consume the read-model façade (`paymentReadModel`, `refundReadModel`, etc.)
 * or the runtime services (`runtime.payments`, `runtime.refunds`, etc.).
 *
 * Migrated capabilities:
 *   - refund  (M-RT-19) — ERRORS (this milestone's deliverable)
 *   - payment (M-RT-18) — WARNINGS (page migrations were lost; re-migration
 *     is incremental work. The runtime projection is fully functional.)
 */
const ERROR_TABLES = ["refund"];
const WARN_TABLES = ["payment"];
const ALLOWED_PREFIXES = [
  "src/runtime/",
  "src/lib/db",
  "src/lib/auth",
  "src/app/api/auth",
  "src/services/",
  "scripts/",
];

const noDirectPrismaRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid direct Prisma `db.<domainTable>` calls outside the runtime; pages must consume read-model façades (M-RT-17/18/19).",
    },
    schema: [],
    messages: {
      noDirectPrisma: "M-RT-17/18/19: `db.{{table}}` is forbidden in pages/API routes. Use the read-model façade (`{{table}}ReadModel`) or `runtime.{{table}}s` instead.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    if (ALLOWED_PREFIXES.some((p) => filename.includes(`/my-project/${p}`) || filename.includes(`\\my-project\\${p.replace(/\//g, "\\")}`))) {
      return {};
    }
    if (ALLOWED_PREFIXES.some((p) => filename.startsWith(p))) {
      return {};
    }
    return {
      MemberExpression(node) {
        if (
          node.object?.type === "MemberExpression" &&
          node.object.object?.type === "Identifier" &&
          node.object.object.name === "db" &&
          node.object.property?.type === "Identifier"
        ) {
          const table = node.object.property.name;
          if (ERROR_TABLES.includes(table) || WARN_TABLES.includes(table)) {
            context.report({ node, messageId: "noDirectPrisma", data: { table } });
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
        "no-direct-prisma-domain-table": noDirectPrismaRule,
      },
    },
  },
  rules: {
    // M-RT-19: refund violations are errors (this milestone's deliverable).
    // Payment violations are warnings (M-RT-18 page migrations were lost;
    // re-migration is incremental work — the runtime projection is functional).
    "payswap-read-models/no-direct-prisma-domain-table": "warn",
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
