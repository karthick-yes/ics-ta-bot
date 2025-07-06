
import promClient from 'prom-client';

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({
    register,
    prefix: 'ics_ta_bot_'
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
    httpRequestsTotal, 
    httpRequestDuration, 
    openaiRequestsTotal, 
    openaiRequestDuration, 
    activeThreads, 
    inappropriateContentBlocked 
};