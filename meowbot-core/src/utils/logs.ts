import log4js from 'log4js';


const colors = {
    purple: '\x1b[35m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    reset: '\x1b[0m'
};

function colorizeLevel(level: string, message: string): string {
    const timestamp = new Date().toLocaleString('zh-CN');
    switch (level) {
        case 'TRACE':
            return `${colors.gray}[${timestamp}] [TRACE] ${message}${colors.reset}`;
        case 'DEBUG':
            return `${colors.purple}[${timestamp}] [DEBUG] ${message}${colors.reset}`;
        case 'INFO':
            return `${colors.green}[${timestamp}] [INFO] ${message}${colors.reset}`;
        case 'WARN':
            return `${colors.yellow}[${timestamp}] [WARN] ${message}${colors.reset}`;
        case 'ERROR':
            return `${colors.red}[${timestamp}] [ERROR] ${message}${colors.reset}`;
        default:
            return `[${timestamp}] [${level}] ${message}`;
    }
}

export class Logger {
    public debug: (...args: any[]) => void;
    public info: (...args: any[]) => void;
    public warn: (...args: any[]) => void;
    public error: (...args: any[]) => void;
    public trace: (...args: any[]) => void;

    constructor(private name: string) {
        this.debug = console.log.bind(console, colorizeLevel('DEBUG', `[${this.name}]`));
        this.info = console.log.bind(console, colorizeLevel('INFO', `[${this.name}]`));
        this.warn = console.warn.bind(console, colorizeLevel('WARN', `[${this.name}]`));
        this.error = console.error.bind(console, colorizeLevel('ERROR', `[${this.name}]`));
        this.trace = console.log.bind(console, colorizeLevel('TRACE', `[${this.name}]`));
    }
}

const loggerCache = new Map<string, Logger>();

export function getLogger(name: string): Logger {
    let logger = loggerCache.get(name);
    if (!logger) {
        logger = new Logger(name);
        loggerCache.set(name, logger);
    }
    return logger;
}

export { log4js };