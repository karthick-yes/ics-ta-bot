
import promClient from 'prom-client';

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({
    register,
    prefix: 'ics_ta_bot_'
});


const userQueriesTotal = new promClient.Counter({
    name: 'ics_ta_bot_user_queries_total', 
    help: 'Total number of queries recorded',
    labelNames: ['email', 'isAdmin'],
    registers: [register]
});

// Count when a user hits their daily limit
const userQueryLimitHitsTotal = new promClient.Counter({
    name: 'ics_ta_bot_user_query_limit_hits_total',
    help: 'Number of times users have hit their daily query limit',
    labelNames: ['email'],
    registers: [register]
});

// Gauge for per-user, per-date daily queries
const userDailyQueries = new promClient.Gauge({
    name: 'ics_ta_bot_user_daily_queries',
    help: 'Daily queries per user/date',
    labelNames: ['email', 'date'],
    registers: [register]
});


// Custom metrics
const httpRequestsTotal = new promClient.Counter({
    name: 'ics_ta_bot_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
    name: 'ics_ta_bot_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

const openaiRequestsTotal = new promClient.Counter({
    name: 'ics_ta_bot_openai_requests_total',
    help: 'Total number of OpenAI API requests',
    labelNames: ['status'],
    registers: [register]
});

const openaiRequestDuration = new promClient.Histogram({
    name: 'ics_ta_bot_openai_request_duration_seconds',
    help: 'Duration of OpenAI API requests in seconds',
    registers: [register]
});

const activeThreads = new promClient.Gauge({
    name: 'ics_ta_bot_active_threads',
    help: 'Number of active OpenAI threads',
    registers: [register]
});

const inappropriateContentBlocked = new promClient.Counter({
    name: 'ics_ta_bot_inappropriate_content_blocked_total',
    help: 'Total number of inappropriate content requests blocked',
    registers: [register]
});

// Export metrics and register
export { 
    register, 
    userDailyQueries,
    userQueriesTotal,
    userQueryLimitHitsTotal,
    httpRequestsTotal, 
    httpRequestDuration, 
    openaiRequestsTotal, 
    openaiRequestDuration, 
    activeThreads, 
    inappropriateContentBlocked 
};