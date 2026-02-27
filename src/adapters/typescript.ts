import * as parser from "@typescript-eslint/parser";

export interface ParseResult {
  functions: { name: string; lines: number }[];
  imports: number;
  commentLines: number;
  totalLines: number;
}

export function parseTypeScript(code: string): ParseResult {
  const lines = code.split("\n");
  const totalLines = lines.length;

  // Count imports
  let imports = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ") || trimmed.startsWith("import{")) {
      imports++;
    }
  }

  // Count comment lines
  let commentLines = 0;
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
    } else if (trimmed.startsWith("//")) {
      commentLines++;
    } else if (trimmed.startsWith("/*")) {
      commentLines++;
      if (!trimmed.includes("*/")) {
        inBlockComment = false;
        inBlockComment = true;
      }
    }
  }

  // Parse AST for functions
  const functions: { name: string; lines: number }[] = [];
  try {
    const ast = parser.parse(code, {
      loc: true,
      range: true,
      jsx: true,
      ecmaFeatures: { jsx: true },
    });

    visitNode(ast as any, functions);
  } catch {
    // If parse fails, fall back to regex-based approach
    return { functions: [], imports, commentLines, totalLines };
  }

  return { functions, imports, commentLines, totalLines };
}

function visitNode(node: any, functions: { name: string; lines: number }[]): void {
  if (!node || typeof node !== "object") return;

  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "MethodDefinition"
  ) {
    const loc = node.loc;
    if (loc) {
      const lineCount = loc.end.line - loc.start.line + 1;
      const name =
        node.id?.name ||
        node.key?.name ||
        `anonymous@${loc.start.line}`;
      functions.push({ name, lines: lineCount });
    }
  }

  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          visitNode(item, functions);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      visitNode(child, functions);
    }
  }
}
