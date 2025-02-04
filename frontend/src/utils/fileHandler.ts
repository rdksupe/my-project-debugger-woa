import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { FileContent } from '../types/common';

export class FileHandler {
  private directory: string;
  private ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/.cache/**',
    '**/coverage/**'
  ];
  private filePatterns = ['**/*.{ts,js,tsx,jsx,json,md,py,java,cpp,c,h,hpp,cs,go,rs,rb}'];

  constructor(directory: string) {
    this.directory = directory;
  }

  async getFilesFromDirectory(): Promise<string[]> {
    try {
      const files = await glob(this.filePatterns, {
        cwd: this.directory,
        ignore: this.ignorePatterns,
        absolute: true,
        nodir: true
      });
      return files;
    } catch (error) {
      console.error(chalk.red('Error scanning directory:', error));
      return [];
    }
  }

  async readFileContent(filePath: string): Promise<string> {
    try {
      const absolutePath = path.resolve(this.directory, filePath);
      return await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
      console.error(chalk.red(`Error reading file ${filePath}:`, error));
      throw error;
    }
  }

  async selectFiles(
    existingFiles: FileContent[] = [], 
    mode: 'scan' | 'manual' = 'scan'
  ): Promise<FileContent[]> {
    let files: FileContent[] = [...existingFiles];

    if (mode === 'scan') {
      const foundFiles = await this.getFilesFromDirectory();
      
      if (foundFiles.length === 0) {
        console.log(chalk.yellow('\nNo matching files found in the directory.'));
        return files;
      }

      const fileSelection = await inquirer.prompt<{ selectedFiles: string[] }>([{
        type: 'checkbox',
        name: 'selectedFiles',
        message: 'Select files to analyze:',
        choices: foundFiles.map(file => ({
          name: path.relative(this.directory, file),
          value: file,
          checked: false
        }))
      }]);

      for (const file of fileSelection.selectedFiles) {
        const content = await this.readFileContent(file);
        files.push({
          name: path.relative(this.directory, file),
          content
        });
      }
    } else {
      // Manual file addition
      let addMoreFiles = true;
      while (addMoreFiles) {
        const fileAnswers = await inquirer.prompt<{ filePath: string }>([{
          type: 'input',
          name: 'filePath',
          message: 'Enter the path to the file:',
          validate: async (input: string) => {
            try {
              await fs.access(path.resolve(this.directory, input));
              return true;
            } catch {
              return 'File does not exist!';
            }
          }
        }]);

        const content = await this.readFileContent(fileAnswers.filePath);
        files.push({
          name: path.basename(fileAnswers.filePath),
          content
        });

        const moreFiles = await inquirer.prompt<{ add: boolean }>([{
          type: 'confirm',
          name: 'add',
          message: 'Would you like to add another file?',
          default: false
        }]);

        addMoreFiles = moreFiles.add;
      }
    }

    return files;
  }
}
