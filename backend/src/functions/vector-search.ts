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
      const table = await db.openTable("vector_store");
  
      const embedding = await portkey.embeddings.create({
        input: body.text,
        model: 'voyage-3'
      });
  
      const results = await table
        .search(embedding.data[0].embedding)
        .limit(body.limit || 5)
        .execute();
  
      return new GSStatus(true, 200, undefined, results, undefined);
    } catch (error) {
      childLogger.error('Error in search operation:', error);
      return new GSStatus(false, 500, undefined, error.message, undefined);
    }
  }