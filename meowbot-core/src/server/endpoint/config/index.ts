import { Injectable, Module, Logger } from "@nestjs/common";

// ── Config interface ──

export interface ServerConfig {
    port: number;
    host: string;
    isDev: boolean;
}

// ── Service ──

@Injectable()
export class ConfigService {
    private readonly logger = new Logger(ConfigService.name);

    get config(): ServerConfig {
        return {
            port: parseInt(process.env.SERVER_PORT ?? "35023", 10),
            host: process.env.SERVER_HOST ?? "0.0.0.0",
            isDev: process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev",
        };
    }

    get port(): number {
        return this.config.port;
    }

    get host(): string {
        return this.config.host;
    }

    get isDev(): boolean {
        const env = process.env.NODE_ENV;
        return !env || env === "development" || env === "dev";
    }
}

// ── Module ──

@Module({
    providers: [ConfigService],
    exports: [ConfigService],
})
export class ConfigModule {}
