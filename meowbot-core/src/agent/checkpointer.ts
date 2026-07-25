import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { getMongoDBClient } from "@meowbot/database";
import { MemorySaver } from "@langchain/langgraph";
import { mongoDBConfig } from "@meowbot/config/app-config";

let _mongoCheckpointer: MongoDBSaver | null = null;

export const checkpointer = {
    memoryCheckpointer: new MemorySaver(),
    
    get mongoCheckpointer(): MongoDBSaver {
        if (!_mongoCheckpointer) {
            _mongoCheckpointer = new MongoDBSaver({
                client: getMongoDBClient().getClient(),
                dbName: mongoDBConfig.database,
            });
        }
        return _mongoCheckpointer;
    },
};
