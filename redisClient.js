import { createClient } from 'redis';
import { Logger } from './logger.js';

const logger = new Logger();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
  }
});

// Events
redisClient.on('connect', () => {
  logger.info('Redis client connected to the server');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready to use');
});

redisClient.on('error', (err) => {
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

// Initialize connection
async function initRedis() {
  try {
    await redisClient.connect();
    logger.info('Redis connection established successfully');

    // Test operation
    await redisClient.set('test_key', 'test_value');
    const testValue = await redisClient.get('test_key');
    logger.info('Redis test successful:', { testValue });
    await redisClient.del('test_key');
  } catch (error) {
    logger.error('Failed to connect to Redis:', {
      error: error.message,
      redisUrl: process.env.REDIS_URL ? 'SET' : 'NOT SET'
    });
    throw error; // important, so app doesn’t silently continue
  }
}

export { redisClient, initRedis };
