import fs from 'fs/promises';
import chalk from 'chalk';

const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript');
const JavaScript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');

// Type definitions for better TypeScript support
declare class TreeSitter {
  parse(input: string): Parser.Tree;
  setLanguage(language: any): void;
}

declare namespace Parser {
  interface Point {
    row: number;
    column: number;
  }

  interface SyntaxNode {
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    children: SyntaxNode[];
  }

  interface Tree {
    rootNode: SyntaxNode;
  }
}

interface ParserResult {
  success: boolean;
  tree?: Parser.Tree;
  error?: string;
  syntax?: {
    type: string;
    startPosition: Parser.Point;
    endPosition: Parser.Point;
    children: number;
  }[];
}

export class TreeSitterParser {
  private parser: TreeSitter;
  private languages: Map<string, any>;

  constructor() {
    this.parser = new Parser();
    this.languages = new Map([
      ['.ts', TypeScript.typescript],
      ['.tsx', TypeScript.tsx],
      ['.js', JavaScript],
      ['.jsx', JavaScript],
      ['.py', Python]
    ]);
  }

  async parseFile(filePath: string, debug: boolean = false): Promise<ParserResult> {
    try {
      const extension = filePath.slice(filePath.lastIndexOf('.'));
      const language = this.languages.get(extension);

      if (!language) {
        return {
          success: false,
          error: `Unsupported file type: ${extension}`
        };
      }

      this.parser.setLanguage(language);
      const code = await fs.readFile(filePath, 'utf-8');
      const tree = this.parser.parse(code);

      if (debug) {
        console.log(chalk.blue('\nTree-sitter Parse Results:'));
        console.log(chalk.gray('─'.repeat(80)));
        this.debugPrintTree(tree.rootNode, code);
        console.log(chalk.gray('─'.repeat(80)));
      }

      // Extract basic syntax information
      const syntax = this.extractSyntaxInfo(tree.rootNode);

      return {
        success: true,
        tree,
        syntax
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error'
      };
    }
  }

  private debugPrintTree(node: Parser.SyntaxNode, sourceCode: string, level: number = 0): void {
    const indent = '  '.repeat(level);
    const nodeText = node.text.replace(/\n/g, '\\n').slice(0, 40);
    console.log(chalk.yellow(`${indent}${node.type}: "${nodeText}"`));
    console.log(chalk.gray(`${indent}Range: (${node.startPosition.row},${node.startPosition.column}) - (${node.endPosition.row},${node.endPosition.column})`));
    
    for (const child of node.children) {
      this.debugPrintTree(child, sourceCode, level + 1);
    }
  }

  private extractSyntaxInfo(node: Parser.SyntaxNode): ParserResult['syntax'] {
    return [{
      type: node.type,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      children: node.children.length
    }];
  }
}

// Debug usage example
async function main() {
  const parser = new TreeSitterParser();
  const testFile = process.argv[2];

  if (!testFile) {
    console.error(chalk.red('Please provide a file path to parse'));
    process.exit(1);
  }

  console.log(chalk.blue(`Parsing file: ${testFile}`));
  const result = await parser.parseFile(testFile, true);

  if (result.success) {
    console.log(chalk.green('\nParsing successful!'));
    console.log(chalk.yellow('\nSyntax Information:'));
    console.log(JSON.stringify(result.syntax, null, 2));
  } else {
    console.error(chalk.red('\nParsing failed:'), result.error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export default TreeSitterParser;
