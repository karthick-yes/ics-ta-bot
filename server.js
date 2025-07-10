import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { callOpenAI, createThread } from './services/openaiService.js';
import authService from './services/authService.js';
import { requireAuth, requireAdmin } from './middleware/authMiddleware.js';
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

// Authentication routes
app.post('/api/auth/request-verification', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    
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
    
    if (!email || !code) {
        return res.status(400).json({ error: 'Email and verification code are required' });
    }
    
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
        if (err) {
            logger.error('Error destroying session', { error: err.message });
        } else {
            logger.info('User logged out', { userEmail });
        }
    });
    res.json({ message: 'Logged out successfully' });
});

// Admin routes for managing whitelist
app.post('/api/admin/whitelist/add', requireAdmin, (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    
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
    
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    
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

// Main page route with authentication check
app.get('/', (req, res) => {
    const token = req.session.authToken;
    
    if (!token) {
        return res.redirect('/auth.html');
    }
    
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

// Protected API endpoint to start a new chat session
app.post('/api/start', requireAuth, async (req, res) => {
    const start = Date.now();
    
    try {
        const userEmail = req.user.email;
        let threadId = req.session.threadId;
        
        // If no thread in session, create a new one
        if (!threadId) {
            const thread = await createThread();
            threadId = thread.id;
            req.session.threadId = threadId;
            
            logger.info('New thread created for authenticated user', { 
                threadId: threadId, 
                userEmail: userEmail,
                sessionId: req.session.id 
            });
        }
        
        // Update metrics
        activeThreads.inc();
        const duration = (Date.now() - start) / 1000;
        openaiRequestsTotal.labels('success').inc();
        openaiRequestDuration.observe(duration);
        
        res.json({ threadId: threadId });
    } catch (error) {
        openaiRequestsTotal.labels('error').inc();
        logger.error('Failed to create OpenAI thread', { 
            error: error.message, 
            stack: error.stack,
            userEmail: req.user.email 
        });
        res.status(500).json({ error: 'Could not start a new session.' });
    }
});

// Protected API endpoint to handle user queries
app.post('/api/query', requireAuth, async (req, res) => {
    const startTime = Date.now();
    const sessionId = req.session.id;
    const userEmail = req.user.email;
    const threadId = req.body.threadId || req.session.threadId;

    if (!threadId) {
        logger.warn('Query received without a threadId from authenticated user', { 
            sessionId, 
            userEmail 
        });
        return res.status(400).json({ error: 'Session not initialized. Please start a new conversation.' });
    }

    try {
        const { prompt } = req.body;

        // Enhanced logging with user info
        logger.logMetrics(sessionId, 'query_received', { 
            promptLength: prompt.length,
            userEmail: userEmail,
            threadId: threadId
        });

        if (!prompt || prompt.trim().length === 0) {
            logger.warn('Empty prompt received from authenticated user', { 
                sessionId, 
                userEmail 
            });
            return res.status(400).json({ error: 'Prompt cannot be empty' });
        }
        
        if (prompt.length > 2000) {
            logger.warn('Prompt too long from authenticated user', { 
                sessionId, 
                userEmail,
                promptLength: prompt.length 
            });
            return res.status(400).json({ error: 'Prompt too long. Please keep it under 2000 characters.' });
        }

        if (containsInappropriateContent(prompt)) {
            inappropriateContentBlocked.inc();
            logger.warn('Inappropriate content detected from authenticated user', { 
                sessionId, 
                userEmail,
                prompt 
            });
            const warningMessage = "I can only help with learning ICS concepts. Please ask questions related to computer science, programming, or course material. I won't provide direct answers to homework or exams.";
            return res.status(403).json({ message: warningMessage });
        }

        const aiResponse = await callOpenAI(prompt, threadId);
        const responseTime = Date.now() - startTime;

        // Update metrics
        openaiRequestsTotal.labels('success').inc();
        openaiRequestDuration.observe(responseTime / 1000);

        // Enhanced logging with user info
        logger.logInteraction(sessionId, prompt, aiResponse, process.env.OPENAI_ASSISTANT_ID, responseTime);
        logger.logMetrics(sessionId, 'query_completed', { 
            responseTime, 
            responseLength: aiResponse.length,
            userEmail: userEmail,
            threadId: threadId
        });

        res.json({ message: aiResponse });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        openaiRequestsTotal.labels('error').inc();
        logger.error('Error processing query from authenticated user', { 
            error: error.message, 
            stack: error.stack, 
            sessionId,
            userEmail: userEmail
        });
        logger.logInteraction(sessionId, req.body.prompt, null, process.env.OPENAI_ASSISTANT_ID, responseTime, error.message);
        logger.logMetrics(sessionId, 'query_failed', { 
            responseTime,
            userEmail: userEmail
        });
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
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
    res.json({
        message: 'Logs are available via Render dashboard or use /metrics for Prometheus metrics',
        metrics_endpoint: '/metrics',
        health_endpoint: '/health'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    const sessionId = req.session?.id || 'anonymous';
    const userEmail = req.user?.email || 'anonymous';
    logger.error('Unhandled error', {
        sessionId,
        userEmail,
        error: err.message,
        stack: err.stack,
        path: req.path
    });
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
    logger.info(`Prometheus metrics available at http://localhost:${PORT}/metrics`);
    logger.info(`Authentication required - visit http://localhost:${PORT}/auth.html to login`);
});