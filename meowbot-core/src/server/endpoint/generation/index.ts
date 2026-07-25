import { Injectable, Controller, Get, Post, Query, Body, Module, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

// ── Service ──

@Injectable()
export class GenerationService {
    private readonly logger = new Logger(GenerationService.name);
    private readonly dataStore = new Map<string, unknown>();

    async store(data: unknown): Promise<string> {
        const id = randomUUID();
        this.dataStore.set(id, data);
        this.logger.log(`Stored generation data: ${id}`);
        return id;
    }

    async fetch(id: string): Promise<unknown | undefined> {
        return this.dataStore.get(id);
    }

    async exists(id: string): Promise<boolean> {
        return this.dataStore.has(id);
    }

    /** Remove expired entries (called periodically). */
    async cleanup(maxAgeMs: number = 600_000): Promise<void> {
        if (this.dataStore.size > 10_000) {
            this.dataStore.clear();
            this.logger.warn("Cleared generation data store (size limit exceeded)");
        }
    }
}

// ── Controller ──

@Controller("generation")
export class GenerationController {
    private readonly logger = new Logger(GenerationController.name);

    constructor(private readonly service: GenerationService) {}

    @Post("data")
    async storeData(@Body() body: unknown): Promise<{ key: string }> {
        const key = await this.service.store(body);
        return { key };
    }

    @Get("data")
    async fetchData(@Query("key") key?: string): Promise<unknown> {
        if (!key) return { error: "missing ?key=" };
        const data = await this.service.fetch(key);
        if (data === undefined) {
            return { error: "data not found", key };
        }
        return data;
    }
}

// ── Module ──

@Module({
    controllers: [GenerationController],
    providers: [GenerationService],
    exports: [GenerationService],
})
export class GenerationModule {}
