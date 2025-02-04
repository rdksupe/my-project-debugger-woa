import { spawn } from 'child_process';
import path from 'path';
import chalk from 'chalk';

interface RipgrepMatch {
  filePath: string;
  lineNumber: number;
  content: string;
  contextBefore: string[];
  contextAfter: string[];
}

interface ErrorContext {
  errorFile: string;
  errorLine: number;
  matches: RipgrepMatch[];
}

export class RipgrepContextGatherer {
  private directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  private async executeRipgrep(filePath: string, lineNumber: number, contextLines: number = 5): Promise<string> {
    return new Promise((resolve, reject) => {
      const rgArgs = [
        '--json',
        '--line-number',
        '--context', contextLines.toString(),
        '--with-filename',
        '-f', '-',  // Read pattern from stdin
        filePath
      ];

      const rg = spawn('rg', rgArgs);
      let output = '';
      let error = '';

      rg.stdin.write(`^.*$`);  // Match the specific line
      rg.stdin.end();

      rg.stdout.on('data', (data) => {
        output += data.toString();
      });

      rg.stderr.on('data', (data) => {
        error += data.toString();
      });

      rg.on('close', (code) => {
        if (code !== 0 && code !== 1) {
          reject(new Error(`ripgrep failed: ${error}`));
        } else {
          resolve(output);
        }
      });
    });
  }

  public async getErrorContext(filePath: string, lineNumber: number): Promise<RipgrepMatch | null> {
    try {
      const output = await this.executeRipgrep(filePath, lineNumber);
      let match: RipgrepMatch | null = null;
      
      const lines = output.split('\n').filter(line => line.trim());
      const contextBefore: string[] = [];
      const contextAfter: string[] = [];
      let content = '';
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.type === 'match' && data.data.line_number === lineNumber) {
            content = data.data.lines.text;
          } else if (data.type === 'context') {
            if (data.data.line_number < lineNumber) {
              contextBefore.push(data.data.lines.text);
            } else {
              contextAfter.push(data.data.lines.text);
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (content) {
        match = {
          filePath: path.relative(this.directory, filePath),
          lineNumber,
          content,
          contextBefore,
          contextAfter
        };
      }

      return match;
    } catch (error) {
      console.error(chalk.yellow('Error getting context:'), error);
      return null;
    }
  }

  public formatContextForSave(match: RipgrepMatch): string {
    const lines: string[] = [];
    
    lines.push(`File: ${match.filePath}`);
    lines.push(`Line ${match.lineNumber}:`);
    lines.push('');
    
    lines.push('Context Before:');
    lines.push(...match.contextBefore);
    
    lines.push('Error Line:');
    lines.push(match.content);
    
    lines.push('Context After:');
    lines.push(...match.contextAfter);
    
    return lines.join('\n');
  }
}
