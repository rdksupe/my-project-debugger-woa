import { GSContext, PlainObject, GSStatus } from "@godspeedsystems/core";
import Portkey from 'portkey-ai';

export const portkey = new Portkey({
  provider:"ollama" , 
  customHost:"http://localhost:1234"
});

// Default configuration for chat completion
export const defaultCompletionConfig = {
  model: 'deepseek-r1-distill-qwen-7b',
  temperature: 0.1, // Lower temperature for code-related tasks
};

interface FileContent {
    name: string;
    content: string;
  }
export default async function (ctx: GSContext, args: PlainObject): Promise<GSStatus> {
    try {
      // Access the body directly from ctx
      const body = ctx.inputs.data.body;
      
      // Debug logging
      console.log('Received body:', JSON.stringify(body, null, 2));
  
      const {
        analysisContext,
        prompt
      } = body;
      
      // Debug logging
      console.log('Extracted data:', {
        contextPresent: !!analysisContext,
        filesPresent: !!analysisContext?.files,
        filesLength: analysisContext?.files?.length,
        errorLogPresent: !!analysisContext?.errorLog,
        projectContextPresent: !!analysisContext?.projectContext,
        promptPresent: !!prompt,
        timestamp: analysisContext?.timestamp
      });
      
      // Validate analysisContext
      if (!analysisContext || typeof analysisContext !== 'object') {
        return new GSStatus(
          false,
          400,
          undefined,
          {
            error: "analysisContext object is required",
            receivedBody: body
          },
          undefined
        );
      }
      
      // Validate files array
      const { files } = analysisContext;
      if (!files) {
        return new GSStatus(
          false,
          400,
          undefined,
          {
            error: "analysisContext.files array is required",
            receivedContext: analysisContext
          },
          undefined
        );
      }
      
      if (!Array.isArray(files)) {
        return new GSStatus(
          false,
          400,
          undefined,
          {
            error: "analysisContext.files must be an array",
            receivedType: typeof files,
            received: files
          },
          undefined
        );
      }
      
      // Validate each file object
      for (const file of files) {
        if (!file || typeof file !== 'object') {
          return new GSStatus(
            false,
            400,
            undefined,
            {
              error: "Each file must be an object",
              receivedType: typeof file,
              received: file
            },
            undefined
          );
        }
      
        if (!file.name || typeof file.name !== 'string') {
          return new GSStatus(
            false,
            400,
            undefined,
            {
              error: "Each file must have a 'name' property of type string",
              received: file
            },
            undefined
          );
        }
      
        if (!file.content || typeof file.content !== 'string') {
          return new GSStatus(
            false,
            400,
            undefined,
            {
              error: "Each file must have a 'content' property of type string",
              received: file
            },
            undefined
          );
        }
      }
      
      // Format files into context
      const fileContexts = files.map((file: FileContent) =>
        `File: ${file.name}\n\n${file.content}\n\n`
      );
      
      // Create system message
      const systemMessage = {
        role: "system",
        content: `You are an expert software developer helping debug code issues.
      Your task is to:
      1. Analyze the provided code files and project context
      2. Review the error log
      3. Answer the user's question with specific references to the code
      4. Consider the project's environment and dependencies
      5. Provide clear, actionable solutions
      
      Focus on being precise and practical in your responses.`
      };
      
      // Create context message with project context
      const contextMessage = {
        role: "user",
        content: [
          "Project Context:",
          "---",
          analysisContext.projectContext,
          "---",
          "Relevant Files:",
          "---",
          ...fileContexts,
          "Error Log:",
          analysisContext.errorLog || "No error log provided",
          "---",
          "Question:",
          prompt || "Please analyze the code and error log, and explain what might be wrong.",
          "---",
          `Analysis requested at: ${analysisContext.timestamp}`
        ].join('\n')
      };
      // Call LLM via Portkey
      try {
        const completion = await portkey.chat.completions.create({
          messages: [
            systemMessage,
            contextMessage
          ],
          ...defaultCompletionConfig
        });
  
        return new GSStatus(
          true,
          200,
          undefined,
          { 
            answer: completion.choices[0].message.content,
            model: completion.model,
            usage: completion.usage
          },
          undefined
        );
  
      } catch (llmError) {
        console.error('LLM Error:', llmError);
        return new GSStatus(
          false,
          503,
          undefined,
          { 
            error: "Error getting LLM response",
            details: llmError.message
          },
          undefined
        );
      }
  
    } catch (error) {
      console.error('Error processing request:', error);
      return new GSStatus(
        false,
        500,
        undefined,
        { 
          error: error.message,
          stack: error.stack,
          inputs: ctx.inputs
        },
        undefined
      );
    }
}