import { GSCloudEvent, GSContext, PlainObject, GSStatus } from "@godspeedsystems/core";
import *  as LanceDB from '@lancedb/lancedb';
import Portkey from 'portkey-ai';
import path from 'path';

const portkey = new Portkey({
  Authorization: process.env.VOYAGE_API_KEY,
  provider: "voyage"
});

const dbPath = path.join(process.cwd(), 'vector-data/data/vectors');

export default async function (ctx: GSContext, args: PlainObject): Promise<GSStatus> {
  const {
    inputs: {
      data: {
        body
      }
    },
    childLogger
  } = ctx;

  try {
    if (!body?.text) {
      return new GSStatus(false, 400, undefined, 'No text provided in request body', undefined);
    }

    const db = await LanceDB.connect(dbPath);
    
    // Create table if it doesn't exist
    let table;
    try {
      table = await db.openTable("vector_store");
    } catch (error) {
      childLogger.info('Creating new vector_store table');
      table = await db.createTable("vector_store", [{
        id: "initial",
        text: "initial entry",
        embedding: new Array(1536).fill(0),
        timestamp: new Date().toISOString()
      }]);
    }

    const embedding = await portkey.embeddings.create({
      input: body.text,
      model: 'voyage-3'
    });

    console.log(embedding.data[0].embedding);

    await table.add([{
      id: Date.now().toString(),
      text: body.text,
      embedding: embedding.data[0].embedding,
      timestamp: new Date().toISOString()
    }]);

    return new GSStatus(true, 200, undefined, 'Vector stored successfully: ' + body.text, undefined);
  } catch (error) {
    childLogger.error('Error in store operation:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new GSStatus(false, 500, undefined, errorMessage, undefined);
  }
}