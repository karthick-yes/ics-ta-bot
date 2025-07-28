import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { GeminiService } from './services/geminiService.js';
import authService from './services/authService.js';
import { UserService } from './services/userService.js';
import { requireAuth, requireAdmin } from './middleware/authMiddleware.js';
import { FeedbackService } from './services/feedbackService.js';
import {
    httpRequestsTotal,
    httpRequestDuration,
    inappropriateContentBlocked,
    register
} from './metrics.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const logger = new Logger();
const geminiService = new GeminiService();
const userService = new UserService();
const feedbackService = new FeedbackService();

let redisClient = createClient({
    url: process.env.REDIS_URL
});

redisClient.connect().catch(console.error);

redisClient.on('error', err => {
    logger.error('Redis Client error', err);
});

let redisStore = new RedisStore({
    client: redisClient,
    prefix: "myapp:"
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    store: redisStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
     }
}));

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

app.use((req, res, next) => {
    const sessionId = req.session.id || 'anonymous';
    logger.info(`${req.method} ${req.originalUrl}`, {
        sessionId,
        userAgent: req.get('User-Agent'),
        ip: req.ip
    });
    next();
});

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

app.post('/api/auth/request-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    try {
        await authService.requestVerification(email);
        logger.info('Verification code sent', { email });
        res.json({ message: 'Verification code sent to your email' });
    } catch (error) {
        logger.warn('Verification request failed', { email, error: error.message });
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and verification code are required' });
    
    try {
        const token = await authService.verifyCode(email, code);
        req.session.authToken = token;
        logger.info('User authenticated successfully', { email });
        res.json({ message: 'Authentication successful', token });
    } catch (error) {
        logger.warn('Authentication failed', { email, error: error.message });
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auth/logout', (req, res) => {
    const userEmail = req.session.authToken ? 'authenticated' : 'anonymous';
    req.session.destroy((err) => {
        if (err) logger.error('Error destroying session', { error: err.message });
        else logger.info('User logged out', { userEmail });
    });
    res.json({ message: 'Logged out successfully' });
});

app.post('/api/admin/whitelist/add', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    try {
        const added = authService.addToWhitelist(email);
        if (added) {
            logger.info('Email added to whitelist', { email, addedBy: req.user.email });
            res.json({ message: 'Email added to whitelist' });
        } else {
            res.json({ message: 'Email already in whitelist' });
        }
    } catch (error) {
        logger.error('Error adding email to whitelist', { email, error: error.message });
        res.status(500).json({ error: 'Failed to add email to whitelist' });
    }
});

app.delete('/api/admin/whitelist/remove', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    try {
        const removed = authService.removeFromWhitelist(email);
        if (removed) {
            logger.info('Email removed from whitelist', { email, removedBy: req.user.email });
            res.json({ message: 'Email removed from whitelist' });
        } else {
            res.status(404).json({ error: 'Email not found in whitelist' });
        }
    } catch (error) {
        logger.error('Error removing email from whitelist', { email, error: error.message });
        res.status(500).json({ error: 'Failed to remove email from whitelist' });
    }
});

app.get('/api/admin/whitelist', requireAdmin, (req, res) => {
    try {
        const whitelist = authService.getWhitelist();
        res.json({ whitelist });
    } catch (error) {
        logger.error('Error retrieving whitelist', { error: error.message });
        res.status(500).json({ error: 'Failed to retrieve whitelist' });
    }
});

app.get('/', (req, res) => {
    const token = req.session.authToken;
    if (!token) return res.redirect('/auth.html');
    
    try {
        const user = authService.verifyToken(token);
        logger.info('Authenticated user accessed main page', { email: user.email });
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } catch (error) {
        logger.warn('Invalid token, redirecting to auth', { error: error.message });
        req.session.destroy();
        res.redirect('/auth.html');
    }
});

app.post('/api/start', requireAuth, async (req, res) => {
    const userEmail = req.user.email;
    try {
        req.session.chatHistory = [];
        logger.info('New Gemini session created', { userEmail, sessionId: req.session.id });
        res.json({ sessionId: req.session.id, message: 'Gemini session initialized' });
    } catch (error) {
        logger.error('Failed to create session', { error: error.message, userEmail });
        res.status(500).json({ error: 'Could not start a new session.' });
    }
});

app.post('/api/query', requireAuth, async (req, res) => {
    const startTime = Date.now();
    const sessionId = req.session.id;
    const userEmail = req.user.email;
    const { prompt } = req.body;

    try {
        const queryLimit = await userService.checkQueryLimit(userEmail);
        if (!queryLimit.allowed) {
            logger.warn('Query limit reached', { userEmail, count: queryLimit.used });
            return res.status(429).json({ error: 'Daily query limit reached. Please try again tomorrow.' });
        }

        if (!prompt || prompt.trim().length === 0) {
            logger.warn('Empty prompt received', { sessionId, userEmail });
            return res.status(400).json({ error: 'Prompt cannot be empty' });
        }

        if (prompt.length > 2000) {
            logger.warn('Prompt too long', { sessionId, userEmail, promptLength: prompt.length });
            return res.status(400).json({ error: 'Prompt too long. Please keep it under 2000 characters.' });
        }

        if (containsInappropriateContent(prompt)) {
            inappropriateContentBlocked.inc();
            logger.warn('Inappropriate content detected', { sessionId, userEmail, prompt });
            return res.status(403).json({ message: "I can only help with learning ICS concepts. Please ask questions related to computer science, programming, or course material. I won't provide direct answers to homework or exams." });
        }

        const chatHistory = req.session.chatHistory || [];
        const result = await geminiService.sendMessage(prompt, chatHistory);
        req.session.chatHistory = result.updatedHistory;

        await userService.recordQuery(userEmail, prompt, result.response);

        const responseTime = Date.now() - startTime;
        logger.logInteraction(sessionId, prompt, result.response, 'gemini', responseTime);
        logger.logMetrics(sessionId, 'query_completed', { responseTime, responseLength: result.response.length, userEmail });

        res.json({ message: result.response });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error('Error processing query', { error: error.message, sessionId, userEmail });
        logger.logInteraction(sessionId, prompt, null, 'gemini', responseTime, error.message);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
    const { feedback } = req.body;
    const userEmail = req.user.email;
    const chatHistory = req.session.chatHistory || [];

    try {
        if (!feedback) return res.status(400).json({ error: 'Feedback text is required' });

        const result = await feedbackService.submitFeedback(
            userEmail,
            'general_feedback', // Using a generic type since it's not attack-specific
            feedback,
            chatHistory
        );

        if (result.success) {
            logger.info('Feedback submitted via FeedbackService', { userEmail, reportId: result.reportId });
            res.json({ message: 'Feedback submitted successfully' });
        } else {
            throw new Error('Feedback submission failed');
        }
    } catch (error) {
        logger.error('Error submitting feedback', { userEmail, error: error.message });
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

app.get('/api/history', requireAuth, (req, res) => {
    try {
        const chatHistory = req.session.chatHistory || [];
        res.json({ 
            history: geminiService.formatHistoryForStorage(chatHistory),
            summary: geminiService.getConversationSummary(chatHistory)
        });
    } catch (error) {
        logger.error('Error retrieving chat history', { error: error.message, userEmail: req.user.email });
        res.status(500).json({ error: 'Failed to retrieve chat history' });
    }
});

app.post('/api/clear-history', requireAuth, (req, res) => {
    try {
        req.session.chatHistory = [];
        logger.info('Chat history cleared', { userEmail: req.user.email, sessionId: req.session.id });
        res.json({ message: 'Chat history cleared' });
    } catch (error) {
        logger.error('Error clearing chat history', { error: error.message, userEmail: req.user.email });
        res.status(500).json({ error: 'Failed to clear chat history' });
    }
});

app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).end(error);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/logs', (req, res) => {
    res.json({
        message: 'Logs are available via Render dashboard or use /metrics for Prometheus metrics',
        metrics_endpoint: '/metrics',
        health_endpoint: '/health'
    });
});

app.use((err, req, res, next) => {
    const sessionId = req.session?.id || 'anonymous';
    const userEmail = req.user?.email || 'anonymous';
    logger.error('Unhandled error', { sessionId, userEmail, error: err.message, stack: err.stack, path: req.path });
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
    logger.info(`Prometheus metrics available at http://localhost:${PORT}/metrics`);
    logger.info(`Authentication required - visit http://localhost:${PORT}/auth.html to login`);
    logger.info(`Using Gemini AI model exclusively`);
});