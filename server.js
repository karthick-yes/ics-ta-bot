import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { callOpenAI, createThread } from './services/openaiService.js';
import { 
    register, 
    httpRequestsTotal, 
    httpRequestDuration, 
    openaiRequestsTotal, 
    openaiRequestDuration, 
    activeThreads, 
    inappropriateContentBlocked 
} from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const logger = new Logger();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Prometheus metrics middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route ? req.route.path : req.path;
        
        httpRequestsTotal.labels(req.method, route, res.statusCode).inc();
        httpRequestDuration.labels(req.method, route, res.statusCode).observe(duration);
    });
    
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    const sessionId = req.session.id || 'anonymous';
    logger.info(`${req.method} ${req.originalUrl}`, {
        sessionId,
        userAgent: req.get('User-Agent'),
        ip: req.ip
    });
    next();
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).end(error);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Logs endpoint (for external scraping)
app.get('/logs', (req, res) => {
    // You can customize this to return recent logs
    res.json({
        message: 'Logs are available via Render dashboard or use /metrics for Prometheus metrics',
        metrics_endpoint: '/metrics',
        health_endpoint: '/health'
    });
});

// Content filtering function
function containsInappropriateContent(text) {
    const inappropriatePatterns = [
        /homework\s+answers?/i,
        /cheat/i,
        /solution\s+manual/i,
        /exam\s+answers?/i,
        /give\s+me\s+the\s+answer/i,
        /just\s+tell\s+me\s+the\s+answer/i
    ];
    return inappropriatePatterns.some(pattern => pattern.test(text));
}

// API endpoint to start a new chat session (and create a thread)
app.post('/api/start', async (req, res) => {
    const start = Date.now();
    
    try {
        const thread = await createThread();
        req.session.threadId = thread.id;
        
        // Update metrics
        activeThreads.inc();
        const duration = (Date.now() - start) / 1000;
        openaiRequestsTotal.labels('success').inc();
        openaiRequestDuration.observe(duration);
        
        logger.info('New thread created', { threadId: thread.id, sessionId: req.session.id });
        res.json({ threadId: thread.id });
    } catch (error) {
        openaiRequestsTotal.labels('error').inc();
        logger.error('Failed to create OpenAI thread', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Could not start a new session.' });
    }
});

// API endpoint to handle user queries
app.post('/api/query', async (req, res) => {
    const startTime = Date.now();
    const sessionId = req.session.id;
    const threadId = req.body.threadId || req.session.threadId;

    if (!threadId) {
        logger.warn('Query received without a threadId', { sessionId });
        return res.status(400).json({ error: 'Session not initialized. Please start a new conversation.' });
    }

    try {
        const { prompt } = req.body;

        logger.logMetrics(sessionId, 'query_received', { promptLength: prompt.length });

        if (!prompt || prompt.trim().length === 0) {
            logger.warn('Empty prompt received', { sessionId });
            return res.status(400).json({ error: 'Prompt cannot be empty' });
        }
        if (prompt.length > 2000) {
            logger.warn('Prompt too long', { sessionId, promptLength: prompt.length });
            return res.status(400).json({ error: 'Prompt too long. Please keep it under 2000 characters.' });
        }

        if (containsInappropriateContent(prompt)) {
            inappropriateContentBlocked.inc();
            logger.warn('Inappropriate content detected', { sessionId, prompt });
            const warningMessage = "I can only help with learning ICS concepts. Please ask questions related to computer science, programming, or course material. I won't provide direct answers to homework or exams.";
            return res.status(403).json({ message: warningMessage });
        }

        const aiResponse = await callOpenAI(prompt, threadId);
        const responseTime = Date.now() - startTime;

        // Update metrics
        openaiRequestsTotal.labels('success').inc();
        openaiRequestDuration.observe(responseTime / 1000);

        logger.logInteraction(sessionId, prompt, aiResponse, process.env.OPENAI_ASSISTANT_ID, responseTime);
        logger.logMetrics(sessionId, 'query_completed', { responseTime, responseLength: aiResponse.length });

        res.json({ message: aiResponse });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        openaiRequestsTotal.labels('error').inc();
        logger.error('Error processing query', { error: error.message, stack: error.stack, sessionId });
        logger.logInteraction(sessionId, req.body.prompt, null, process.env.OPENAI_ASSISTANT_ID, responseTime, error.message);
        logger.logMetrics(sessionId, 'query_failed', { responseTime });
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    const sessionId = req.session?.id || 'anonymous';
    logger.error('Unhandled error', {
        sessionId,
        error: err.message,
        stack: err.stack,
        path: req.path
    });
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
    logger.info(`Prometheus metrics available at http://localhost:${PORT}/metrics`);
});