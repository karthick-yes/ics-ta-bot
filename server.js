import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
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
import { error } from 'console';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const logger = new Logger();
const geminiService = new GeminiService();
const userService = new UserService();
const feedbackService = new FeedbackService();

let redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

redisClient.on('connect', () => {
    logger.info('Redis client connected to the server')
});

redisClient.on('ready', () => {
    logger.info('Redis client ready to use')
});

redisClient.on('error', err => {
    logger.error('Redis Client error', {
        error: err.message,
        code: err.code,
        stack: err.stack
    });
});

redisClient.on('end', () => {
    logger.warn('Redis client connection ended');
});

redisClient.on('reconnecting', () => {
    logger.info('Redis client reconnecting...');
});

//debug statement
try {
    await redisClient.connect();
    logger.info('Redis connection established successfully');
} catch (error) {
    logger.error('Failed to connect to Redis:', { 
        error: error.message,
        redisUrl: process.env.REDIS_URL ? 'SET' : 'NOT SET'
    });
}


// Test Redis functionality
try {
    await redisClient.set('test_key', 'test_value');
    const testValue = await redisClient.get('test_key');
    logger.info('Redis test successful:', { testValue });
    await redisClient.del('test_key');
} catch (error) {
    logger.error('Redis test failed:', { error: error.message });
}
 

let redisStore = new RedisStore({
    client: redisClient,
    prefix: "icstabot:",
    ttl:86400,
    disableTouch: false
});

redisStore.on('error', (err) => {
    logger.error('RedisStore error: ', {error: err.message});
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    store: redisStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Refresh session expiry on each request
    name: 'icsbot.session', // Custom session name
    cookie: { 
        secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

// Session debugging middleware
app.use((req, res, next) => {
    const sessionInfo = {
        sessionId: req.session.id,
        isNew: req.session.isNew,
        hasAuthToken: !!req.session.authToken,
        hasChatHistory: !!req.session.chatHistory,
        chatHistoryLength: req.session.chatHistory?.length || 0,
        sessionKeys: Object.keys(req.session),
        redisConnected: redisClient.isReady,
        redisStatus: redisClient.isOpen,
    };
    
    if (req.path.startsWith('/api/')) {
        logger.info('Session Debug:', sessionInfo);
    }
    
    next();
});

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

//debug
app.get('/debug-whitelist', (req, res) => {
    try {
        const debug = {
            whitelistLength: authService.getWhitelist().length,
            whitelist: authService.getWhitelist(),
            tempCodesCount: Object.keys(authService.getTempCodes ? authService.getTempCodes() : {}).length,
            
            // Test specific emails
            emailTests: {
                'ics.learning.ashoka@gmail.com': authService.isEmailWhitelisted('ics.learning.ashoka@gmail.com'),
                'shristi.sharma_ug2024@ashoka.edu.in': authService.isEmailWhitelisted('shristi.sharma_ug2024@ashoka.edu.in'),
                'yashita.mishra_ug2024@ashoka.edu.in': authService.isEmailWhitelisted('yashita.mishra_ug2024@ashoka.edu.in')
            }
        };

        // Check file system (if using old version)
        const whitelistPath = path.join(__dirname, './data/whitelist.json');
        if (fs.existsSync(whitelistPath)) {
            const fileContent = fs.readFileSync(whitelistPath, 'utf8');
            debug.fileSystemWhitelist = JSON.parse(fileContent);
        } else {
            debug.fileSystemWhitelist = 'File does not exist';
        }

        res.json(debug);
    } catch (error) {
        res.json({ error: error.message, stack: error.stack });
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

    // Detailed session debugging
    logger.info('Feedback submission debug:', {
        userEmail,
        sessionId: req.session.id,
        sessionAge: req.session.cookie.maxAge,
        sessionIsNew: req.session.isNew,
        hasHistory: !!req.session.chatHistory,
        historyLength: chatHistory.length,
        historyPreview: chatHistory.slice(-2), // Last 2 messages for debugging
        redisConnected: redisClient.isReady,
        redisStatus: redisClient.status,
        sessionKeys: Object.keys(req.session)
    });

    try {
        if (!feedback) return res.status(400).json({ error: 'Feedback text is required' });

        const result = await feedbackService.submitFeedback(
            userEmail,
            'general_feedback',
            feedback,
            chatHistory
        );

        if (result.success) {
            logger.info('Feedback submitted successfully:', { 
                userEmail, 
                reportId: result.reportId,
                conversationLength: chatHistory.length 
            });
            res.json({ message: 'Feedback submitted successfully' });
        } else {
            throw new Error('Feedback submission failed');
        }
    } catch (error) {
        logger.error('Feedback submission error:', { 
            userEmail, 
            error: error.message,
            sessionId: req.session.id 
        });
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

//DEBUG test session persistence

app.post('/api/debug/session-test', requireAuth, (req, res) => {
    const { testData } = req.body;
    
    if (!req.session.testHistory) {
        req.session.testHistory = [];
    }
    
    req.session.testHistory.push({
        timestamp: new Date().toISOString(),
        data: testData || 'test message',
        count: req.session.testHistory.length + 1
    });
    
    logger.info('Session test data stored:', {
        sessionId: req.session.id,
        historyLength: req.session.testHistory.length
    });
    
    res.json({
        message: 'Test data stored in session',
        sessionId: req.session.id,
        testHistory: req.session.testHistory,
        totalMessages: req.session.testHistory.length
    });
});

app.get('/api/debug/session-test', requireAuth, (req, res) => {
    res.json({
        sessionId: req.session.id,
        testHistory: req.session.testHistory || [],
        chatHistory: req.session.chatHistory || [],
        sessionKeys: Object.keys(req.session)
    });
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

app.get('/api/debug/redis', requireAuth, async (req, res) => {
    try {
        const ping = await redisClient.ping();
        
        const testKey = `test_${Date.now()}`;
        await redisClient.set(testKey, 'test_value', { EX: 10 });
        const testValue = await redisClient.get(testKey);
        await redisClient.del(testKey);
        
        // Get Redis info
        const info = await redisClient.info();
        
        // Test session store
        const sessionKeys = await redisClient.keys('icsbot:*');
        
        res.json({
            redis: {
                connected: redisClient.isReady,
                status: redisClient.status,
                ping: ping,
                testOperation: testValue === 'test_value' ? 'SUCCESS' : 'FAILED',
                sessionKeys: sessionKeys.length,
                info: info.split('\n').slice(0, 10) // First 10 lines of info
            },
            session: {
                id: req.session.id,
                isNew: req.session.isNew,
                keys: Object.keys(req.session),
                chatHistoryLength: req.session.chatHistory?.length || 0
            },
            environment: {
                redisUrl: process.env.REDIS_URL ? 'SET' : 'NOT SET',
                nodeEnv: process.env.NODE_ENV
            }
        });
    } catch (error) {
        logger.error('Redis debug endpoint error:', { error: error.message });
        res.status(500).json({ 
            error: error.message,
            redis: {
                connected: redisClient.isReady,
                status: redisClient.status
            }
        });
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