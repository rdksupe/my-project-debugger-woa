import { GSContext } from "@godspeedsystems/core";

export default async function (ctx: GSContext, args: any) {
    const { inputs: { data: { body } } } = ctx;
    const { messages, prompt, config = {} } = body;

    const ds = ctx.datasources.portkey;
    
    const response = await ds.execute(ctx, {
        messages,
        prompt,
        config,
        meta: { fnNameInWorkflow: 'datasource.portkey.chat' }
    });

    return response;
}