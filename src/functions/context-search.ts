import { GSContext, PlainObject, GSStatus } from "@godspeedsystems/core";
import Portkey from 'portkey-ai';

export const portkey = new Portkey({
  provider:"ollama" , 
  customHost:"http://localhost:1234"
});

// Default configuration for chat completion
export const defaultCompletionConfig = {
  model: 'hermes-3-llama-3.2-3b',
  temperature: 0.1, // Lower temperature for code-related tasks
  max_tokens: 2048
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
        files,
        errorLog,
        prompt,
        model = defaultCompletionConfig.model
      } = body;
  
      // Debug logging
      console.log('Extracted data:', {
        filesPresent: !!files,
        filesLength: files?.length,
        errorLogPresent: !!errorLog,
        promptPresent: !!prompt
      });
  
      if (!files) {
        return new GSStatus(
          false,
          400,
          undefined,
          { 
            error: "files array is required",
            receivedBody: body 
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
            error: "files must be an array",
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
  1. Analyze the provided code files
  2. Review the error log
  3. Answer the user's question with specific references to the code
  4. Provide clear, actionable solutions
  
  Focus on being precise and practical in your responses.`
      };
  
      // Create context message
      const contextMessage = {
        role: "user",
        content: [
          "Here are the relevant files and error log:",
          "---",
          ...fileContexts,
          "Error Log:",
          errorLog || "No error log provided",
          "---",
          "Question:",
          prompt || "Please analyze the code and error log, and explain what might be wrong."
        ].join('\n')
      };
  
      // Call LLM via Portkey
      try {
        const completion = await portkey.chat.completions.create({
          model: model,
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