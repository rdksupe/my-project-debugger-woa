#!/usr/bin/env ts-node

  import { Command } from 'commander';
  import inquirer from 'inquirer';
  import fs from 'fs/promises';
  import path from 'path';
  import chalk from 'chalk';
  import axios from 'axios';
  import { glob } from 'glob';
  import { promisify } from 'util';
  import { ProjectContextGatherer } from '../utils/ProjectContextGatherer';
  import { writeFile } from 'fs/promises';
  import { ConversationManager } from '../utils/conversationManager';
  import { ConversationSession, ConversationMessage } from '../types/conversation';
  import { FileHandler } from '../utils/fileHandler';
  import { FileContent } from '../types/common';

  // Type definitions

  interface Interaction {
    prompt: string;
    response: string;
    timestamp: string;
  }

  interface AnalysisContext {
    files: FileContent[];
    errorLog: string;
    projectContext: string;
    timestamp: string;
    conversationHistory?: {
      messages: ConversationMessage[];
      interactions: Interaction[];
    };
  }

  interface LLMResponse {
    answer: string;
    model: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    choices?: Array<{
      message: {
        content: string;
        role: string;
      };
      index: number;
      finish_reason: string;
    }>;
  }

  interface APIResponse {
    success?: boolean;  // Made optional since it's not in the response
    code?: number;      // Made optional since it's not in the response
    answer: string;     // Direct properties from the response
    model: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }

  // Update the ChalkColor type to match chalk's actual color methods
  type ChalkColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray' | 'grey';

  interface DisplayOptions {
    wrapWidth?: number;
    codeBlockColor?: ChalkColor;
    textColor?: ChalkColor;
  }

  // Constants
  const DEFAULT_API_URL = 'http://localhost:3000/api/code/context';
  const DEFAULT_FILE_PATTERNS = ['**/*.{ts,js,tsx,jsx,json,md,py,java,cpp,c,h,hpp,cs,go,rs,rb}'];
  const IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/.cache/**',
    '**/coverage/**'
  ];
  interface StackTraceFrame {
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
    functionName?: string;
    methodName?: string;
    className?: string;
    isNative?: boolean;
    isConstructor?: boolean;
    fileRelativePath?: string;
    rawLine: string;
  }

  interface ParsedStackTrace {
    message: string;
    type?: string;
    frames: StackTraceFrame[];
    rawStack: string;
  }

  // Add these constants for stack trace parsing
  const STACK_TRACE_PATTERNS = {
    // Node.js/V8 style
    nodeStyle: /at\s+(?:(?<functionName>[^(]+)?\s+)?\(?(?<fileInfo>(?<fileName>[^:]+):(?<lineNumber>\d+):(?<columnNumber>\d+))?\)?/,
    
    // Browser style
    browserStyle: /(?<functionName>[^@]*)@(?<fileName>[^:]+):(?<lineNumber>\d+):(?<columnNumber>\d+)/,
    
    // Java/JVM style
    javaStyle: /at\s+(?<className>[\w$\.]+)\.(?<methodName>[\w$]+)\((?<fileName>[\w$\.]+):(?<lineNumber>\d+)\)/,
    
    // Python style
    pythonStyle: /File\s+"(?<fileName>[^"]+)",\s+line\s+(?<lineNumber>\d+),\s+in\s+(?<functionName>\w+)/,
    
    // Common error message pattern
    errorMessage: /(?<type>[\w$\.]+Error):\s+(?<message>.*)/
  };

  // Add these helper functions for stack trace parsing
  function parseStackTrace(errorLog: string): ParsedStackTrace {
    const lines = errorLog.trim().split('\n').map(line => line.trim());
    const frames: StackTraceFrame[] = [];
    let message = '';
    let type = '';

    // Try to extract error type and message from the first line
    const errorMatch = lines[0].match(STACK_TRACE_PATTERNS.errorMessage);
    if (errorMatch?.groups) {
      type = errorMatch.groups.type;
      message = errorMatch.groups.message;
    } else {
      message = lines[0];
    }

    // Process each line of the stack trace
    for (const line of lines.slice(1)) {
      let frame: Partial<StackTraceFrame> = { rawLine: line };
      let matched = false;

      // Try each pattern
      for (const [style, pattern] of Object.entries(STACK_TRACE_PATTERNS)) {
        if (style === 'errorMessage') continue;

        const match = line.match(pattern);
        if (match?.groups) {
          matched = true;
          frame = {
            ...frame,
            ...match.groups,
            lineNumber: match.groups.lineNumber ? parseInt(match.groups.lineNumber, 10) : undefined,
            columnNumber: match.groups.columnNumber ? parseInt(match.groups.columnNumber, 10) : undefined
          };

          // Process function name for constructor calls
          if (frame.functionName) {
            frame.isConstructor = frame.functionName.includes('new ');
            frame.functionName = frame.functionName.replace('new ', '').trim();
          }

          // Process file paths
          if (frame.fileName) {
            frame.isNative = frame.fileName.includes('native');
            frame.fileRelativePath = path.relative(process.cwd(), frame.fileName);
          }

          break;
        }
      }

      if (matched && frame.fileName) {
        frames.push(frame as StackTraceFrame);
      }
    }

    return {
      message,
      type,
      frames,
      rawStack: errorLog
    };
  }
  async function prepareAnalysisContext(
    files: FileContent[],
    errorLog: string,
    stackTrace: ParsedStackTrace,
    directory: string,
    session?: ConversationSession,
    currentPrompt?: string
  ): Promise<AnalysisContext> {
    try {
      const contextGatherer = new ProjectContextGatherer(directory);
      const projectContext = await contextGatherer.formatForLLM();

      let conversationHistory;
      // console.log(session?.messages);
      if (session?.messages) {
        // Build interactions array from messages
        const interactions: Interaction[] = [];
        let userMessage: ConversationMessage | undefined;
        
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            userMessage = msg;
          } else if (msg.role === 'assistant' && userMessage) {
            interactions.push({
              prompt: userMessage.content,
              response: msg.content,
              timestamp: msg.timestamp
            });
            userMessage = undefined;
          }
        }

        // Add current prompt if provided
        if (currentPrompt) {
          interactions.push({
            prompt: currentPrompt,
            response: '',
            timestamp: new Date().toISOString()
          });
        }



        conversationHistory = {
          messages: session.messages,
          interactions
        };
      }

      return {
        files,
        errorLog,
        projectContext,
        timestamp: new Date().toISOString(),
        conversationHistory
      };
    } catch (error) {
      console.error(chalk.yellow('Warning: Error gathering project context:'), error);
      // Return basic context if project context gathering fails
      return {
        files,
        errorLog,
        projectContext: 'Project context gathering failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Add this function to analyze stack trace and find relevant files
  async function analyzeStackTrace(
    stackTrace: ParsedStackTrace,
    baseDir: string
  ): Promise<Set<string>> {
    const relevantFiles = new Set<string>();
    const filePatterns = new Set<string>();

    // Extract file patterns from stack trace
    for (const frame of stackTrace.frames) {
      if (frame.fileName) {
        const fileName = path.basename(frame.fileName);
        const fileNameWithoutExt = path.parse(fileName).name;
        
        // Add exact file name
        filePatterns.add(`**/${fileName}`);
        
        // Add pattern for files with different extensions
        filePatterns.add(`**/${fileNameWithoutExt}.*`);

        // If it's a TypeScript error, also look for related definition files
        if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
          filePatterns.add(`**/${fileNameWithoutExt}.d.ts`);
        }

        // If it's a compiled file, look for source files
        if (fileName.endsWith('.js')) {
          filePatterns.add(`**/${fileNameWithoutExt}.ts`);
          filePatterns.add(`**/${fileNameWithoutExt}.tsx`);
        }
      }
    }

    // Find files matching the patterns
    try {
      const files = await glob(Array.from(filePatterns), {
        cwd: baseDir,
        ignore: IGNORE_PATTERNS,
        absolute: true,
        nodir: true
      });

      files.forEach(file => relevantFiles.add(file));
    } catch (error) {
      console.error(chalk.yellow('Error finding related files:', error));
    }

    return relevantFiles;
  }

  // Add this function to get context around error lines
  async function getErrorContext(
    filePath: string,
    lineNumber: number,
    contextLines: number = 5
  ): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, lineNumber - contextLines - 1);
      const end = Math.min(lines.length, lineNumber + contextLines);
      
      return lines
        .slice(start, end)
        .map((line, index) => {
          const currentLineNumber = start + index + 1;
          const isErrorLine = currentLineNumber === lineNumber;
          return `${currentLineNumber.toString().padStart(4)} | ${
            isErrorLine ? chalk.red(line) : line
          }`;
        })
        .join('\n');
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // Helper Functions
  function displayFormattedResponse(
    response: APIResponse,
    options: DisplayOptions = {}
  ): void {
    const {
      wrapWidth = 80,
      codeBlockColor = 'cyan',
      textColor = 'white'
    } = options;

    // Helper function to safely apply chalk colors
    const applyChalkColor = (text: string, color: ChalkColor): string => {
      const chalkMethod = chalk[color];
      return typeof chalkMethod === 'function' ? chalkMethod(text) : text;
    };

    try {
      // First, display raw JSON in debug mode
      console.log(chalk.yellow('\nDebug: Raw Response:'));
      console.log(chalk.gray('─'.repeat(wrapWidth)));
      console.log(chalk.white(JSON.stringify(response, null, 2)));
      console.log(chalk.gray('─'.repeat(wrapWidth)));

      if (!response?.answer) {
        throw new Error('Invalid response format: missing answer field');
      }

      const answer = response.answer.trim();
      const metadata = response;

      console.log('\n' + chalk.green('Analysis Result:'));
      console.log(chalk.gray('─'.repeat(wrapWidth)));

      // Split the response into segments, preserving code blocks
      const segments: string[] = answer.split(/(```[\s\S]*?```)/g);

      segments.forEach((segment: string) => {
        segment = segment.trim();
        if (!segment) return;

        if (segment.startsWith('```')) {
          // Handle code blocks
          const codeBlock = segment
            .replace(/```(\w+)?/, '')
            .replace(/```$/, '')
            .trim();
          const language = segment.match(/```(\w+)/)?.[1] || '';

          console.log(chalk.yellow(`\nCode${language ? ` (${language})` : ''}:`));
          console.log(applyChalkColor(codeBlock, codeBlockColor));
          console.log(); // Empty line after code block
        } else {
          // Handle regular text with proper word wrapping
          const words = segment.split(/\s+/);
          let currentLine = '';

          words.forEach((word: string) => {
            if ((currentLine + ' ' + word).length <= wrapWidth) {
              currentLine += (currentLine ? ' ' : '') + word;
            } else {
              if (currentLine) {
                console.log(applyChalkColor(currentLine, textColor));
              }
              currentLine = word;
            }
          });

          if (currentLine) {
            console.log(applyChalkColor(currentLine, textColor));
          }
        }
      });

      console.log(chalk.gray('─'.repeat(wrapWidth)));

      // Display metadata if available
      if (metadata.model) {
        console.log(chalk.gray(`\nModel: ${metadata.model}`));
      }

      if (metadata.usage) {
        console.log(chalk.gray('Usage Statistics:'));
        console.log(chalk.gray(`  - Prompt Tokens: ${metadata.usage.prompt_tokens}`));
        console.log(chalk.gray(`  - Completion Tokens: ${metadata.usage.completion_tokens}`));
        console.log(chalk.gray(`  - Total Tokens: ${metadata.usage.total_tokens}`));
      }
    } catch (error) {
      // Display parsing error details
      console.error(chalk.red('\nError parsing response:'));
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      
      console.log(chalk.yellow('\nAttempting to display raw response data:'));
      console.log(chalk.gray('─'.repeat(wrapWidth)));
      
      try {
        // Try different ways to display the response data
        if (typeof response === 'string') {
          console.log(chalk.white(response));
        } else if (response instanceof Buffer) {
          console.log(chalk.white(response.toString()));
        } else {
          console.log(chalk.white(JSON.stringify(response, null, 2)));
        }
      } catch (displayError) {
        console.error(chalk.red('\nFailed to stringify response:'));
        console.error(chalk.red(displayError instanceof Error ? displayError.message : 'Unknown error'));
        console.log(chalk.white(response));
      }
      
      console.log(chalk.gray('─'.repeat(wrapWidth)));
    }
  }

  // Add new helper function
  async function saveContextToFile(
    context: any,
    directory: string,
    prefix: string = 'llm-context'
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}-${timestamp}.json`;
    const filepath = path.join(directory, filename);

    try {
      await writeFile(
        filepath,
        JSON.stringify(context, null, 2),
        'utf-8'
      );
      return filepath;
    } catch (error) {
      console.error(chalk.red('Error saving context to file:'), error);
      throw error;
    }
  }

  async function sendToLLM(
    files: FileContent[],
    errorLog: string,
    prompt?: string,
    saveContext: boolean = false,
    session?: ConversationSession
  ): Promise<APIResponse> {
    try {
      const stackTrace = parseStackTrace(errorLog);
      const analysisContext = await prepareAnalysisContext(
        files,
        errorLog,
        stackTrace,
        process.cwd(),
        session,
        prompt
      );

      // Get the last assistant response if it exists

      const requestPayload = {
        analysisContext,
        prompt: prompt || "Please analyze the code and error log, and explain what might be wrong.",
        conversationHistory: session?.messages || [],
        
      };

      // Save context if requested
      if (saveContext) {
        try {
          const savedPath = await saveContextToFile(requestPayload, process.cwd());
          console.log(chalk.green('\nContext saved to:'), chalk.cyan(savedPath));
        } catch (error) {
          console.error(chalk.yellow('Warning: Failed to save context file'), error);
        }
      }

      const response = await axios.post<LLMResponse>(DEFAULT_API_URL, requestPayload);
      
      // Handle both direct and choices-based responses
      let answer: string;
      if (response.data.choices && response.data.choices.length > 0) {
        answer = response.data.choices[0].message.content;
      } else if (response.data.answer) {
        answer = response.data.answer;
      } else {
        throw new Error('No valid answer found in response');
      }

      // Construct standardized API response
      const apiResponse: APIResponse = {
        answer,
        model: response.data.model || 'unknown',
        usage: response.data.usage
      };

      return apiResponse;
    } catch (error) {
      // Enhanced error logging
      console.error(chalk.red('\nDetailed Error Information:'));
      if (error instanceof Error && error.message.includes('ProjectContextGatherer')) {
        console.error(chalk.yellow('Error gathering project context:'), error.message);
      } else if (axios.isAxiosError(error)) {
        console.error(chalk.red(`Status: ${error.response?.status || 'unknown'}`));
        console.error(chalk.red(`Message: ${error.message}`));
        if (error.response?.data) {
          console.error(chalk.yellow('\nResponse Data:'));
          console.error(JSON.stringify(error.response.data, null, 2));
        }
      } else {
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
      throw error;
    }
  }


  // Add new helper function
  async function printProjectContext(directory: string, debug: boolean = false): Promise<void> {
    try {
      console.log(chalk.blue('\nGathering Project Context...'));
      const gatherer = new ProjectContextGatherer(directory);
      const context = await gatherer.formatForLLM();
      
      console.log(chalk.gray('─'.repeat(80)));
      console.log(context);
      console.log(chalk.gray('─'.repeat(80)));

      if (debug) {
        const rawInfo = await gatherer.gatherEnvironmentInfo();
        console.log(chalk.yellow('\nDebug: Raw Project Information:'));
        console.log(JSON.stringify(rawInfo, null, 2));
      }
    } catch (error) {
      console.error(chalk.red('Error gathering project context:'), error);
      throw error;
    }
  }

  // Add timezone formatting helper at the top level
  function formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour12: false
    });
  }

  // Main CLI Application
  async function main() {
    const program = new Command();

    program
      .name('code-help')
      .description('CLI tool to get AI help with code issues')
      .version('1.1.0.3');

    // Add new command for context
    program
      .command('context')
      .description('Display project context information')
      .option('-d, --directory <path>', 'Specify directory to scan', process.cwd())
      .option('--debug', 'Show raw context data', false)
      .action(async (options) => {
        try {
          await printProjectContext(options.directory, options.debug);
        } catch (error) {
          console.error(chalk.red('Error:'), error);
          process.exit(1);
        }
      });

    program
      .command('analyze')
      .description('Analyze code files and error logs')
      .option('-d, --directory <path>', 'Specify directory to scan', process.cwd())
      .option('-p, --pattern <pattern>', 'File pattern to match')
      .option('--debug', 'Enable debug mode', false)
      .option('--save-context', 'Save the analysis context to a file', false)
      .action(async (options) => {
        try {
          console.log(chalk.blue('\nCode Analysis Helper'));
          console.log(chalk.blue('===================\n'));

          const fileHandler = new FileHandler(options.directory);
          let files: FileContent[] = [];

          // File Selection Method
          const fileQuestions = await inquirer.prompt<{ fileSelection: 'scan' | 'manual' }>([
            {
              type: 'list',
              name: 'fileSelection',
              message: 'How would you like to add files?',
              choices: [
                { name: 'Scan current directory', value: 'scan' },
                { name: 'Add files manually', value: 'manual' }
              ]
            }
          ]);

          files = await fileHandler.selectFiles([], fileQuestions.fileSelection);

          // Error Log Input
          const errorLogQuestions = await inquirer.prompt<{ errorLog: string }>([
            {
              type: 'editor',
              name: 'errorLog',
              message: 'Please paste your error log (press i to start editing, ESC then :wq to save):',
              default: ''
            }
          ]);

          // Optional Question Input



          const stackTrace = parseStackTrace(errorLogQuestions.errorLog);

        
          if (options.debug) {
            console.log(chalk.yellow('\nParsed Stack Trace:'));
            console.log(JSON.stringify(stackTrace, null, 2));
          }
    
          console.log(chalk.blue('\nError Analysis:'));
          console.log(chalk.red(`Error: ${stackTrace.type || 'Unknown Error'}`));
          console.log(chalk.red(`Message: ${stackTrace.message}`));
    
          // Find relevant files
          const relevantFiles = await analyzeStackTrace(stackTrace, options.directory);
    
          if (relevantFiles.size > 0) {
            console.log(chalk.yellow('\nRelevant files found:'));
            for (const file of relevantFiles) {
              console.log(chalk.cyan(`- ${path.relative(options.directory, file)}`));
            }
    
            // Show context for error locations
            console.log(chalk.yellow('\nError context:'));
            for (const frame of stackTrace.frames) {
              if (frame.fileName && frame.lineNumber) {
                const filePath = path.resolve(options.directory, frame.fileName);
                if (await fs.access(filePath).then(() => true).catch(() => false)) {
                  console.log(chalk.cyan(`\nIn ${frame.fileName}:`));
                  console.log(await getErrorContext(filePath, frame.lineNumber));
                }
              }
            }
    
            // Ask user which files to include
            const fileSelection = await inquirer.prompt<{ selectedFiles: string[] }>([
              {
                type: 'checkbox',
                name: 'selectedFiles',
                message: 'Select files to include in analysis:',
                choices: Array.from(relevantFiles).map(file => ({
                  name: path.relative(options.directory, file),
                  value: file,
                  checked: true
                }))
              }
            ]);
    
            // Add selected files to analysis
            for (const file of fileSelection.selectedFiles) {
              const content = await fileHandler.readFileContent(file);
              files.push({
                name: path.relative(options.directory, file),
                content
              });
            }
          }



          const promptQuestions = await inquirer.prompt<{ hasPrompt: boolean; prompt?: string }>([
            {
              type: 'confirm',
              name: 'hasPrompt',
              message: 'Would you like to add a specific question?',
              default: false
            },
            {
              type: 'input',
              name: 'prompt',
              message: 'Enter your question:',
              when: (answers) => answers.hasPrompt
            }
          ]);
          // Show Summary
          console.log(chalk.yellow('\nAnalysis Summary:'));
          console.log('─'.repeat(50));
          console.log(chalk.white('Files to analyze:'));
          files.forEach(f => console.log(chalk.cyan(`- ${f.name}`)));
          console.log(chalk.white(`\nError log size: ${errorLogQuestions.errorLog.length} characters`));
          if (promptQuestions.prompt) {
            console.log(chalk.white(`Question: ${promptQuestions.prompt}`));
          }
          console.log('─'.repeat(50));

          // Confirmation
          const confirm = await inquirer.prompt<{ proceed: boolean }>([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Would you like to proceed with the analysis?',
              default: true
            }
          ]);

          if (!confirm.proceed) {
            console.log(chalk.yellow('\nOperation cancelled'));
            return;
          }

          // Show Progress
          console.log(chalk.blue('\nSending request to AI...'));

          try {
            // Call API and handle response
            const response = await sendToLLM(
              files,
              errorLogQuestions.errorLog,
              promptQuestions.prompt,
              options.saveContext  // Pass the save option
            );

            // Display the response with debug information
            displayFormattedResponse(response, {
              wrapWidth: 80,
              codeBlockColor: 'cyan',
              textColor: 'white'
            });

          } catch (error) {
            if (options.debug) {
              console.error(chalk.red('\nDetailed Error Information:'));
              console.error(error);
            } else {
              console.error(chalk.red('\nError during analysis:'), error instanceof Error ? error.message : error);
            }
          }
        } catch (error) {
          console.error(chalk.red('Error during analysis:', error));
          if (options.debug) {
            console.error('\nStack trace:', error);
          }
        }
      });

    // Add to the main CLI application
    program
      .command('chat')
      .description('Start an interactive debugging session')
      .option('-d, --directory <path>', 'Specify directory to scan', process.cwd())
      .option('--debug', 'Enable debug mode', false)
      .option('-c, --continue', 'Continue an existing session', false)
      .action(async (options) => {
        const conversationManager = new ConversationManager(options.directory);
        const fileHandler = new FileHandler(options.directory);
        await conversationManager.initialize();
        
        let session: ConversationSession;
        let currentFiles: FileContent[] = [];
        let currentErrorLog: string = '';
        let lastMessageTimestamp: string = '';

        if (options.continue) {
          // Get recent sessions
          const recentSessions = await conversationManager.getRecentSessions();
          
          if (recentSessions.length === 0) {
            console.log(chalk.yellow('\nNo existing sessions found. Starting new session...'));
            session = await conversationManager.createSession();
          } else {
            // Let user choose a session
            const { sessionId } = await inquirer.prompt<{ sessionId: string }>([{
              type: 'list',
              name: 'sessionId',
              message: 'Choose a session to continue:',
              choices: recentSessions.map(s => ({
                name: `${s.id} (${s.messages.length} messages)`,
                value: s.id,
                description: s.messages[s.messages.length - 1]?.content || 'No messages'
              }))
            }]);

            session = await conversationManager.loadSession(sessionId);
            
            // Restore last state
            const lastMessage = session.messages[session.messages.length - 1];
            if (lastMessage) {
              lastMessageTimestamp = lastMessage.timestamp;
              currentFiles = lastMessage.files ? await Promise.all(
                lastMessage.files.map(async f => ({
                  name: f,
                  content: await fileHandler.readFileContent(path.join(options.directory, f))
                }))
              ) : [];
              currentErrorLog = lastMessage.errorLog || '';
            }

            console.log(chalk.green('\nContinuing session from:', (session.startTime).toLocaleString()));
            console.log(chalk.gray('Last message:', new Date(lastMessageTimestamp).toLocaleString()));
          }
        } else {
          session = await conversationManager.createSession();
        }

        console.log(chalk.blue('\nStarting interactive debugging session...'));
        console.log(chalk.gray('Type "quit" to exit, "history" to view conversation history\n'));

        while (true) {
          const { command } = await inquirer.prompt<{ command: string }>([{
            type: 'input',
            name: 'command',
            message: chalk.green('What would you like to do?')
          }]);

          if (command.toLowerCase() === 'quit') {
            session.endTime = new Date().toISOString();
            await conversationManager.saveSession(session); // Final save
            break;
          }
          if (command.toLowerCase() === 'history') {
            // Show conversation history with resolved error summaries
            console.log(chalk.yellow('\nConversation History:'));
            session.messages.forEach((msg) => {
              const prefix = msg.isResolved ? chalk.gray('(Resolved) ') : '';
              console.log(chalk.gray(`\n--- ${prefix}${msg.role.toUpperCase()} (${formatTimestamp(msg.timestamp)}) ---`));
              if (msg.contextUpdate) {
                console.log(chalk.cyan('Context Updates:'));
                if (msg.contextUpdate.addedFiles?.length) {
                  console.log(chalk.green(`Added files: ${msg.contextUpdate.addedFiles.join(', ')}`));
                }
                if (msg.contextUpdate.removedFiles?.length) {
                  console.log(chalk.red(`Removed files: ${msg.contextUpdate.removedFiles.join(', ')}`));
                }
                if (msg.contextUpdate.errorLogChanged) {
                  console.log(chalk.yellow('Error log was updated'));
                }
              }
              console.log(msg.content);
            });
            continue;
          }

          // Initial file selection if no files are selected
          if (currentFiles.length === 0) {
            const { fileSelection } = await inquirer.prompt<{ fileSelection: 'scan' | 'manual' }>([{
              type: 'list',
              name: 'fileSelection',
              message: 'How would you like to add files?',
              choices: [
                { name: 'Scan current directory', value: 'scan' },
                { name: 'Add files manually', value: 'manual' }
              ]
            }]);

            currentFiles = await fileHandler.selectFiles([], fileSelection);
          }

          // Error log handling
          let errorLogChanged = false;
          if (!currentErrorLog) {
            const { errorLog } = await inquirer.prompt<{ errorLog: string }>([{
              type: 'editor',
              name: 'errorLog',
              message: 'Please paste your error log:',
              default: ''
            }]);
            currentErrorLog = errorLog;
            errorLogChanged = true;
          } else {
            const { updateErrorLog } = await inquirer.prompt<{ updateErrorLog: boolean }>([{
              type: 'confirm',
              name: 'updateErrorLog',
              message: 'Would you like to update the error log?',
              default: false
            }]);

            if (updateErrorLog) {
              const { errorLog } = await inquirer.prompt<{ errorLog: string }>([{
                type: 'editor',
                name: 'errorLog',
                message: 'Please paste your updated error log:',
                default: currentErrorLog
              }]);
              currentErrorLog = errorLog;
              errorLogChanged = true;
            }
          }

          const timestamp = new Date().toISOString();
          const message: ConversationMessage = {
            id: timestamp,
            role: 'user',
            content: command,
            timestamp: timestamp,
            files: currentFiles.map(f => f.name),
            errorLog: currentErrorLog,
            replyTo: lastMessageTimestamp,
            contextUpdate: {
              errorLogChanged
            }
          };

          // Save message immediately
          await conversationManager.addMessage(session.id, message);

          try {
            const response = await sendToLLM(
              currentFiles,
              currentErrorLog,
              command,
              options.saveContext,
              session // Pass the updated session with the new message
            );

            const assistantTimestamp = new Date().toISOString();
            const assistantMessage: ConversationMessage = {
              id: assistantTimestamp,
              role: 'assistant',
              content: response.answer,
              timestamp: assistantTimestamp,
              replyTo: timestamp
            };

            lastMessageTimestamp = assistantTimestamp;
            // Save assistant message immediately
            await conversationManager.addMessage(session.id, assistantMessage);
            displayFormattedResponse(response);

            // Ask if error is resolved
            const { isResolved } = await inquirer.prompt<{ isResolved: boolean }>([{
              type: 'confirm',
              name: 'isResolved',
              message: 'Has this error been resolved?',
              default: false
            }]);

            if (isResolved) {
              await conversationManager.markErrorAsResolved(
                session.id,
                currentErrorLog,
                [message, assistantMessage]
              );

              const resolutionTimestamp = new Date().toISOString();
              const resolutionMessage: ConversationMessage = {
                id: resolutionTimestamp,
                role: 'system',
                content: 'Error resolved',
                timestamp: resolutionTimestamp,
                replyTo: assistantTimestamp,
                isResolved: true
              };

              await conversationManager.addMessage(session.id, resolutionMessage);
              console.log(chalk.green('\nGreat! Error has been resolved.'));
              
              const { endSession } = await inquirer.prompt<{ endSession: boolean }>([{
                type: 'confirm',
                name: 'endSession',
                message: 'Would you like to end the session?',
                default: true
              }]);

              if (endSession) {
                session.endTime = new Date().toISOString();
                // Single final save
                await conversationManager.saveSession(session);
                console.log(chalk.blue('\nSession ended. Goodbye!'));
                break;
              }
              
              console.log(chalk.blue('\nContinuing session...'));
              continue;
            }

            // Continue with context update handling if error not resolved
            const { needMoreContext } = await inquirer.prompt<{ needMoreContext: boolean }>([{
              type: 'confirm',
              name: 'needMoreContext',
              message: 'Would you like to update the context (files/error log)?',
              default: false
            }]);

            if (needMoreContext) {
              const { keepExisting } = await inquirer.prompt<{ keepExisting: boolean }>([{
                type: 'confirm',
                name: 'keepExisting',
                message: 'Would you like to keep the existing files?',
                default: true
              }]);

              const existingFiles = [...currentFiles];

              const { fileSelection } = await inquirer.prompt<{ fileSelection: 'scan' | 'manual' }>([{
                type: 'list',
                name: 'fileSelection',
                message: 'How would you like to add more files?',
                choices: [
                  { name: 'Scan current directory', value: 'scan' },
                  { name: 'Add files manually', value: 'manual' }
                ]
              }]);

              currentFiles = await fileHandler.selectFiles(
                keepExisting ? currentFiles : [],
                fileSelection
              );

              const contextUpdateTimestamp = new Date().toISOString();
              const contextUpdateMessage: ConversationMessage = {
                id: contextUpdateTimestamp,
                role: 'system',
                content: 'Context updated',
                timestamp: contextUpdateTimestamp,
                replyTo: assistantTimestamp,
                contextUpdate: {
                  addedFiles: currentFiles.slice(keepExisting ? existingFiles.length : 0).map(f => f.name),
                  removedFiles: keepExisting ? [] : existingFiles.map(f => f.name)
                }
              };

              // Save context update message immediately
              await conversationManager.addMessage(session.id, contextUpdateMessage);
            }

          } catch (error) {
            const errorTimestamp = new Date().toISOString();
            const errorMessage: ConversationMessage = {
              id: errorTimestamp,
              role: 'system',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              timestamp: errorTimestamp,
              replyTo: timestamp
            };
            // Save error message immediately
            await conversationManager.addMessage(session.id, errorMessage);
          }
        }

        console.log(chalk.blue('\nSession ended. Goodbye!'));
      });

    program.parse();
  }

  // Execute
  main().catch((error) => {
    console.error(chalk.red('Fatal Error:', error));
    process.exit(1);
  });