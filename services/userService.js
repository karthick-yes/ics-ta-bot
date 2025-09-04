import { Logger } from '../logger.js';
import {
    userQueriesTotal,
    userQueryLimitHitsTotal,
    userDailyQueries
} from '../metrics.js';
import authService from './authService.js';
import { redisClient } from '../redisClient.js';

const logger = new Logger();

class UserService {
    constructor() {
        // Configuration for daily limits
        this.config = {
            dailyQueryLimit: parseInt(process.env.DAILY_QUERY_LIMIT) || 15,
            adminEmails: []
        };
    }
    //remember to init this stuff in ther server code.
    async init() {
        // Pull from Redis via AuthService
        const redisAdmins = await authService.getAdminlist();

        if (redisAdmins && redisAdmins.length > 0) {
            this.config.adminEmails = redisAdmins;
        } else {
            // fallback to env if Redis has nothing
            this.config.adminEmails = (process.env.ADMIN_EMAILS || process.env.EMAIL_USER || '')
                .split(',')
                .map(email => email.trim())
                .filter(Boolean);
        }
    }

    async isAdmin(email){
        return await authService.isEmailAdmin(email);
    }

    /**
     * Gets the current date as a string in YYYY-MM-DD format.
     * This is used as the field name within our Redis Hash.
     */
    getTodayKey() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Checks if a user has reached their daily query limit.
     * @param {string} email - The user's email.
     * @returns {object} - An object indicating if the query is allowed.
     * potential admin dashboard api
     */
    async checkQueryLimit(email) {
        try {
            
            // Admins always have unlimited queries.
            if (this.isAdmin(email)) {
                return { allowed: true, remaining: 'unlimited', isAdmin: true };
            }

            const today = this.getTodayKey();
            // Each user gets their own hash key, e.g., "user_queries:test@example.com"
            const userKey = `user_queries:${email}`;
            
            // HGET retrieves the value for a specific field (today's date) from the user's hash.
            const currentCount = await redisClient.hGet(userKey, today);
            const used = parseInt(currentCount) || 0;

            const remaining = this.config.dailyQueryLimit - used;

            if (used >= this.config.dailyQueryLimit) {
                userQueryLimitHitsTotal.inc({ email });
            }

            return {
                allowed: used < this.config.dailyQueryLimit,
                remaining: Math.max(0, remaining),
                used: used,
                limit: this.config.dailyQueryLimit,
                isAdmin: false
            };
        } catch (error) {
            logger.error('Failed to check query limit from Redis', { email, error: error.message });
            // On error, allow the query to prevent system failure, but log it.
            return { allowed: true, remaining: 'unknown', error: true };
        }
    }

    /**
     * Records a query for a user, incrementing their daily count.
     * @param {string} email - The user's email.
     * @param {string} prompt - The user's prompt.
     */
    async recordQuery(email, prompt) {
        try {

            // Don't count queries for admins against the limit.
            if (this.isAdmin(email)) {
                logger.info('Admin query recorded (not counted towards limit)', { email });
                return;
            }

            const today = this.getTodayKey();
            const userKey = `user_queries:${email}`;

            // HINCRBY is an atomic operation that increments the value of a hash field.
            // It's perfect for counters. It returns the new value after incrementing.
            const newCount = await redisClient.hIncrBy(userKey, today, 1);

            // Set an expiration on the key. After 30 days, Redis will automatically
            // delete this user's hash, keeping our database clean.
            await redisClient.expire(userKey, 30 * 24 * 60 * 60);

            // Prometheus — total queries
            userQueriesTotal.inc({ email, isAdmin: isAdmin.toString() });

            // Prometheus — per user/date gauge
            userDailyQueries.set({ email, date: today }, newCount);

            logger.info('Query recorded in Redis', {
                email,
                dailyCount: newCount,
                promptLength: prompt.length
            });

        } catch (error) {
            logger.error('Failed to record query in Redis', { email, error: error.message });
            // Don't re-throw the error, as we don't want to block the user's request.
        }
    }
    
    // admin api
    async getUserStats(email) {
        const userKey = `user_queries:${email}`;
        const stats = await redisClient.hGetAll(userKey);
        for (const date in stats) {
            stats[date] = parseInt(stats[date], 10);
            userDailyQueries.set({ email , date }, stats[date]);
        }

        return stats;
    }

    //admin api
    async getAllUserStats() {
        const allStats = {};
        let cursor = 0;
        do {
            const [nextCursor, keys] = await redisClient.scan(cursor, {
                MATCH: 'user_queries:*',
                COUNT: 100
            });

            for (const key of keys) {
                const email = key.replace('user_queries:', '');
                const stats = await redisClient.hGetAll(key);

                for (const date in stats) {
                    stats[date] = parseInt(stats[date], 10);
                    userDailyQueries.set({ email, date }, stats[date]);
                }

                allStats[email] = stats;
            }
            cursor = parseInt(nextCursor, 10);
        } while (cursor !== 0);

        return allStats;
    }
        //NOTE: well I decided to implement this, it is kinda cool.
}

export { UserService };
