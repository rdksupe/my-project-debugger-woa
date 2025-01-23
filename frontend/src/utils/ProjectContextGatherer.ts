import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
}

interface ProjectStructure {
  [key: string]: {
    type: 'file' | 'directory';
    path: string;
    size?: number;
    extension?: string;
    lastModified?: Date;
    children?: ProjectStructure;
  };
}

interface Dependencies {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

interface GitInfo {
  branch: string | null;
  commit: string | null;
  remoteUrl: string | null;
  status: string | null;
}

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  scripts?: Record<string, string>;
}

interface EnvironmentInfo {
  timestamp: string;
  system: SystemInfo;
  project: {
    path: string;
    structure: ProjectStructure;
    dependencies: Dependencies | null;
    git: GitInfo | null;
    packageInfo: PackageInfo | null;
  };
  environmentVariables: Record<string, string>;
}

export class ProjectContextGatherer {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async gatherEnvironmentInfo(): Promise<EnvironmentInfo> {
    try {
      const envInfo: EnvironmentInfo = {
        timestamp: new Date().toISOString(),
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          cpuCores: os.cpus().length,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
        },
        project: {
          path: this.projectPath,
          structure: await this.getProjectStructure(),
          dependencies: await this.getDependencies(),
          git: await this.getGitInfo(),
          packageInfo: await this.getPackageInfo(),
        },
        environmentVariables: this.getFilteredEnvVars(),
      };

      return envInfo;
    } catch (error) {
      console.error('Error gathering environment info:', error);
      throw error;
    }
  }

  private async getProjectStructure(dir: string = this.projectPath, depth: number = 0, maxDepth: number = 5): Promise<ProjectStructure> {
    const structure: ProjectStructure = {};
    
    try {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        if (file.startsWith('.') || file === 'node_modules') continue;
        
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        const relativePath = path.relative(this.projectPath, fullPath);

        if (stat.isDirectory() && depth < maxDepth) {
          structure[file] = {
            type: 'directory',
            path: relativePath,
            children: await this.getProjectStructure(fullPath, depth + 1, maxDepth)
          };
        } else if (stat.isFile()) {
          structure[file] = {
            type: 'file',
            path: relativePath,
            size: stat.size,
            extension: path.extname(file),
            lastModified: stat.mtime
          };
        }
      }
      
      return structure;
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
      return {};
    }
  }

  private async getDependencies(): Promise<Dependencies | null> {
    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      return {
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        peerDependencies: packageJson.peerDependencies || {}
      };
    } catch {
      return null;
    }
  }

  private async getGitInfo(): Promise<GitInfo | null> {
    try {
      const commands = {
        branch: 'git branch --show-current',
        commit: 'git rev-parse HEAD',
        remoteUrl: 'git config --get remote.origin.url',
        status: 'git status --porcelain'
      };

      const gitInfo: Partial<GitInfo> = {};
      
      for (const [key, command] of Object.entries(commands)) {
        try {
          const { stdout } = await execAsync(command, { cwd: this.projectPath });
          gitInfo[key as keyof GitInfo] = stdout.trim();
        } catch {
          gitInfo[key as keyof GitInfo] = null;
        }
      }

      return gitInfo as GitInfo;
    } catch {
      return null;
    }
  }

  private async getPackageInfo(): Promise<PackageInfo | null> {
    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      return {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        author: packageJson.author,
        license: packageJson.license,
        scripts: packageJson.scripts
      };
    } catch {
      return null;
    }
  }

  private getFilteredEnvVars(): Record<string, string> {
    const sensitivePatterns = [
      /key/i,
      /token/i,
      /password/i,
      /secret/i,
      /credential/i,
      /auth/i
    ];

    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value && !sensitivePatterns.some(pattern => pattern.test(key))) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  async formatForLLM(): Promise<string> {
    const info = await this.gatherEnvironmentInfo();
    
    return `
# Project and Environment Context
Generated at: ${info.timestamp}

## System Information
- Platform: ${info.system.platform}
- Architecture: ${info.system.arch}
- Node Version: ${info.system.nodeVersion}
- CPU Cores: ${info.system.cpuCores}
- Memory: ${Math.round(info.system.totalMemory / 1024 / 1024 / 1024)}GB total, ${Math.round(info.system.freeMemory / 1024 / 1024 / 1024)}GB free

## Project Information
- Project Path: ${info.project.path}
${info.project.packageInfo ? `
- Name: ${info.project.packageInfo.name}
- Version: ${info.project.packageInfo.version}
- Description: ${info.project.packageInfo.description}
`: ''}

## Git Information
${info.project.git ? `
- Current Branch: ${info.project.git.branch}
- Latest Commit: ${info.project.git.commit}
- Remote URL: ${info.project.git.remoteUrl}
- Status: ${info.project.git.status || 'Clean'}
`: 'No Git information available'}

## Project Structure
\`\`\`
${this.formatStructure(info.project.structure)}
\`\`\`

## Dependencies
${info.project.dependencies ? `
### Production Dependencies
${Object.entries(info.project.dependencies.dependencies || {})
    .map(([name, version]) => `- ${name}: ${version}`).join('\n')}

### Development Dependencies
${Object.entries(info.project.dependencies.devDependencies || {})
    .map(([name, version]) => `- ${name}: ${version}`).join('\n')}
`: 'No dependency information available'}
`;
  }

  private formatStructure(structure: ProjectStructure, prefix: string = '', isLast: boolean = true): string {
    let output = '';
    const entries = Object.entries(structure);
    
    entries.forEach(([name, info], index) => {
      const isLastEntry = index === entries.length - 1;
      const marker = isLastEntry ? '└── ' : '├── ';
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      output += `${prefix}${marker}${name}\n`;
      
      if (info.type === 'directory' && info.children) {
        output += this.formatStructure(info.children, newPrefix, isLastEntry);
      }
    });
    
    return output;
  }
}

// Example usage:
async function main() {
  const gatherer = new ProjectContextGatherer(process.cwd());
  const formattedContext = await gatherer.formatForLLM();
  console.log(formattedContext);

  // Or get raw data
  const rawInfo = await gatherer.gatherEnvironmentInfo();
  // console.log(JSON.stringify(rawInfo, null, 2));
}

if (require.main === module) {
  main().catch(console.error);
}

export default ProjectContextGatherer;