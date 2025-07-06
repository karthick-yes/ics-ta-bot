import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { callOpenAI, createThread } from './services/openaiService.js';

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
    try {
        const thread = await createThread();
        req.session.threadId = thread.id;
        logger.info('New thread created', { threadId: thread.id, sessionId: req.session.id });
        res.json({ threadId: thread.id });
    } catch (error) {
        logger.error('Failed to create OpenAI thread', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Could not start a new session.' });
    }
});


// API endpoint to handle user queries
app.post('/api/query', async (req, res) => {
    const startTime = Date.now();
    const sessionId = req.session.id;
    const threadId = req.session.threadId;

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
            logger.warn('Inappropriate content detected', { sessionId, prompt });
            const warningMessage = "I can only help with learning ICS concepts. Please ask questions related to computer science, programming, or course material. I won't provide direct answers to homework or exams.";
            return res.status(403).json({ message: warningMessage });
        }

        const aiResponse = await callOpenAI(prompt, threadId);
        const responseTime = Date.now() - startTime;

        logger.logInteraction(sessionId, prompt, aiResponse, process.env.OPENAI_ASSISTANT_ID, responseTime);
        logger.logMetrics(sessionId, 'query_completed', { responseTime, responseLength: aiResponse.length });

        res.json({ message: aiResponse });

    } catch (error) {
        const responseTime = Date.now() - startTime;
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
});
