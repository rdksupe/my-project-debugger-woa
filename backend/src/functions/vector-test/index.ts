// src/functions/vector-test/index.ts

import { GSCloudEvent, GSContext, PlainObject, GSStatus } from "@godspeedsystems/core";
import *  as LanceDB from '@lancedb/lancedb';
import Portkey from 'portkey-ai';
import path from 'path';

const portkey = new Portkey({
  Authorization: process.env.VOYAGE_API_KEY,
  provider: "voyage"
});

const dbPath = path.join(process.cwd(), './data/vectors');

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
    childLogger.info('Function called with body:', body);
    
    if (!body?.text) {
      return new GSStatus(
        false,
        400,
        undefined,
        { error: 'No text provided in request body' },
        undefined
      );
    }

    const db = await LanceDB.connect(dbPath);

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

    // Use the endpoint to determine the operation
    if (ctx.inputs.data.path.includes('/store')) {
      const embedding = await portkey.embeddings.create({
        input: body.text,
        model: 'voyage-3'
      });

      console.log('embedding created',embedding) ; 

      await table.add([{
        id: Date.now().toString(),
        text: body.text,
        embedding: embedding.data[0].embedding,
        timestamp: new Date().toISOString()
      }]);

      return new GSStatus(true, 200, undefined, 'Vector stored successfully: ' + body.text, undefined);
    } else {
      const embedding = await portkey.embeddings.create({
        input: body.text,
        model: 'voyage-3'
      });

      const results = await table
        .search(embedding.data[0].embedding)
        .limit(body.limit || 5)
        .execute();

      return new GSStatus(true, 200, undefined, results, undefined);
    }
  } catch (error) {
    childLogger.error('Error:', error);
    return new GSStatus(false, 500, undefined, error.message, undefined);
  }
}
