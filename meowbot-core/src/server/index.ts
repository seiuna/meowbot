import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { Module, type INestApplication } from "@nestjs/common";
import express from "express";
import { GenerationModule, GenerationService, ConfigModule, ConfigService, ApiModule, ServeModule, WorkspaceModule } from "./endpoint/index.js";
import { getLogger } from "../utils/logs.js";

const logger = getLogger("Server");

const DEFAULT_PORT = 35023;

// ── Root module — import feature modules here ──

@Module({
    imports: [GenerationModule, ConfigModule, ApiModule, ServeModule, WorkspaceModule],
})
class AppModule {}

// ── Server singleton ──

export class AppServer {
    private static instance: AppServer;
    private app: INestApplication | null = null;
    private _port = 0;
    private shutdownHandlersRegistered = false;

    static getInstance(): AppServer {
        if (!AppServer.instance) {
            AppServer.instance = new AppServer();
        }
        return AppServer.instance;
    }

    private constructor() {}

    private registerShutdownHandlers(): void {
        if (this.shutdownHandlersRegistered) return;
        this.shutdownHandlersRegistered = true;

        const shutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            await this.stop();
            process.exit(0);
        };

        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("beforeExit", () => shutdown("beforeExit"));
    }

    /** Start the NestJS server with Express adapter. */
    async start(port = DEFAULT_PORT): Promise<void> {
        if (this.app) return;

        const expressApp = express();
        const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
        nestApp.enableCors({
            origin: true,
            methods: ["GET", "POST", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        });
        await nestApp.listen(port, "0.0.0.0");

        this.app = nestApp;
        this._port = port;
        this.registerShutdownHandlers();
        logger.info(`Server listening on http://127.0.0.1:${this._port}`);
    }

    /**
     * Store screenshot generation data via NestJS service.
     * Returns the key that frontend pages use to retrieve it.
     */
    async storeGenerationData(data: unknown): Promise<string> {
        if (!this.app) throw new Error("Server not started — call start() first");
        const svc = this.app.get(GenerationService);
        return svc.store(data);
    }

    get baseUrl(): string {
        return `http://127.0.0.1:${this._port}`;
    }

    get port(): number {
        return this._port;
    }

    /** Whether running in development mode (delegates to ConfigService). */
    get isDev(): boolean {
        if (!this.app) {
            // Default to dev when NODE_ENV is not explicitly "production"
            const env = process.env.NODE_ENV;
            return !env || env === "development" || env === "dev";
        }
        const config = this.app.get(ConfigService);
        return config.isDev;
    }

    /** Base URL for generation pages (dev: localhost:5173, prod: AppServer base). */
    get generationBaseUrl(): string {
        return this.isDev ? "http://localhost:5173" : this.baseUrl;
    }

    async stop(): Promise<void> {
        if (this.app) {
            await this.app.close();
            this.app = null;
            logger.info("Server stopped");
        }
    }
}
