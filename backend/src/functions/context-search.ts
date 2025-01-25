import { GSContext } from "@godspeedsystems/core";

interface FileContent {
    name: string;
    content: string;
}

export default async function (ctx: GSContext, args: any) {
    try {
        const { inputs: { data: { body } } } = ctx;
        const { analysisContext, prompt, config = {} } = body;

        // Debug logging
        console.log('Received body:', JSON.stringify(body, null, 2));

        // Validate analysisContext and format messages
        if (!analysisContext || typeof analysisContext !== 'object') {
            throw new Error("analysisContext object is required");
        }

        const { files } = analysisContext;
        if (!files || !Array.isArray(files)) {
            throw new Error("analysisContext.files array is required");
        }

        // Format files into context
        const fileContexts = files.map((file: FileContent) =>
            `File: ${file.name}\n\n${file.content}\n\n`
        );

        // Create messages array for the LLM
        const messages = [
            {
                role: "system",
                content: `You are an expert software developer helping debug code issues.
                Your task is to:
                1. Analyze the provided code files and project context
                2. Review the error log
                3. Answer the user's question with specific references to the code
                4. Consider the project's environment and dependencies
                5. Provide clear, actionable solutions
                
                Focus on being precise and practical in your responses.`
            },
            {
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
            }
        ];

        const ds = ctx.datasources.tokenjs;
        
        const response = await ds.execute(ctx, {
            messages,
            prompt,
            config,
            meta: { fnNameInWorkflow: 'datasource.tokenjs.chat' }
        });

        return response;

    } catch (error: any) {
        console.error('Error in code analysis:', error);
        throw error;
    }
}