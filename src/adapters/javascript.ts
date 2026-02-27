import * as acorn from "acorn";
import * as walk from "acorn-walk";

export interface ParseResult {
  functions: { name: string; lines: number }[];
  imports: number;
  commentLines: number;
  totalLines: number;
}

export function parseJavaScript(code: string): ParseResult {
  const lines = code.split("\n");
  const totalLines = lines.length;

  // Count imports
  let imports = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("import{") ||
      (trimmed.startsWith("const ") && trimmed.includes("require(")) ||
      (trimmed.startsWith("let ") && trimmed.includes("require(")) ||
      (trimmed.startsWith("var ") && trimmed.includes("require("))
    ) {
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
        inBlockComment = true;
      }
    }
  }

  // Parse AST for functions
  const functions: { name: string; lines: number }[] = [];
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    });

    walk.simple(ast, {
      FunctionDeclaration(node: any) {
        if (node.loc) {
          functions.push({
            name: node.id?.name || `anonymous@${node.loc.start.line}`,
            lines: node.loc.end.line - node.loc.start.line + 1,
          });
        }
      },
      FunctionExpression(node: any) {
        if (node.loc) {
          functions.push({
            name: node.id?.name || `anonymous@${node.loc.start.line}`,
            lines: node.loc.end.line - node.loc.start.line + 1,
          });
        }
      },
      ArrowFunctionExpression(node: any) {
        if (node.loc) {
          functions.push({
            name: `arrow@${node.loc.start.line}`,
            lines: node.loc.end.line - node.loc.start.line + 1,
          });
        }
      },
    });
  } catch {
    return { functions: [], imports, commentLines, totalLines };
  }

  return { functions, imports, commentLines, totalLines };
}
