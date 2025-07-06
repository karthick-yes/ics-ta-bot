import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

export class Logger {
    constructor() {
        const today = new Date().toISOString().split('T')[0];
        this.logFile = path.join(logsDir, `app-${today}.log`);
        this.interactionFile = path.join(logsDir, `interactions-${today}.log`);
        this.metricsFile = path.join(logsDir, `metrics-${today}.log`);
    }

    _writeToFile(filePath, logLine) {
        try {
            fs.appendFileSync(filePath, logLine + '\n');
        } catch (error) {
            console.error(`Failed to write to log file ${filePath}`, error);
        }
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...(data && { data }),
            pid: process.pid
        };
        const logLine = JSON.stringify(logEntry);
        this._writeToFile(this.logFile, logLine);
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
    }

    logInteraction(sessionId, userPrompt, aiResponse, model, responseTime, error = null) {
        const timestamp = new Date().toISOString();
        const interaction = {
            timestamp,
            sessionId,
            userPrompt,
            aiResponse,
            model,
            responseTime,
            ...(error && { error }),
            promptLength: userPrompt.length,
            responseLength: aiResponse ? aiResponse.length : 0
        };
        const logLine = JSON.stringify(interaction);
        this._writeToFile(this.interactionFile, logLine);
        this.info(`Interaction logged for session ${sessionId}`);
    }

    logMetrics(sessionId, event, data = {}) {
        const timestamp = new Date().toISOString();
        const metric = {
            timestamp,
            sessionId,
            event,
            data
        };
        const logLine = JSON.stringify(metric);
        this._writeToFile(this.metricsFile, logLine);
    }

    error(message, data = null) {
        this.log('ERROR', message, data);
    }

    info(message, data = null) {
        this.log('INFO', message, data);
    }

    warn(message, data = null) {
        this.log('WARN', message, data);
    }
}
