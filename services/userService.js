import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';
import { Logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config()
const logger = new Logger();

class UserService {
    constructor() {
        // Configuration for daily limits
        this.config = {
            dailyQueryLimit: parseInt(process.env.DAILY_QUERY_LIMIT) || 15,
            adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim()).filter(Boolean),
            dataFile: path.join(__dirname, '../data/user_queries.json')
        };
        
        this.ensureDataDirectory();
    }

    async ensureDataDirectory() {
        try {
            const dataDir = path.dirname(this.config.dataFile);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            logger.error('Failed to create data directory', { error: error.message });
        }
    }

    async loadUserData() {
        try {
            const data = await fs.readFile(this.config.dataFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, return empty data
                return {};
            }
            logger.error('Failed to load user data', { error: error.message });
            return {};
        }
    }

    async saveUserData(data) {
        try {
            await fs.writeFile(this.config.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error('Failed to save user data', { error: error.message });
            throw error;
        }
    }

    getTodayKey() {
        return new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    async getUserQueries(email) {
        const userData = await this.loadUserData();
        const today = this.getTodayKey();
        
        if (!userData[email]) {
            userData[email] = {};
        }
        
        if (!userData[email][today]) {
            userData[email][today] = {
                count: 0,
                lastQuery: null,
                queries: []
            };
        }
        
        return { userData, today, userToday: userData[email][today] };
    }

    async checkQueryLimit(email) {
        try {
            // Admins have unlimited queries
            if (this.config.adminEmails.includes(email)) {
                return { 
                    allowed: true, 
                    remaining: 'unlimited', 
                    isAdmin: true 
                };
            }

            const { userToday } = await this.getUserQueries(email);
            const remaining = this.config.dailyQueryLimit - userToday.count;
            
            return {
                allowed: userToday.count < this.config.dailyQueryLimit,
                remaining: Math.max(0, remaining),
                used: userToday.count,
                limit: this.config.dailyQueryLimit,
                isAdmin: false
            };
        } catch (error) {
            logger.error('Failed to check query limit', { email, error: error.message });
            // On error, allow the query to prevent complete system failure
            return { allowed: true, remaining: 'unknown', error: true };
        }
    }

    async recordQuery(email, prompt, response = null, metadata = {}) {
        try {
            const { userData, today, userToday } = await this.getUserQueries(email);
            
            // Don't count queries for admins in the limit, but still record them
            if (!this.config.adminEmails.includes(email)) {
                userToday.count++;
            }
            
            userToday.lastQuery = new Date().toISOString();
            userToday.queries.push({
                timestamp: new Date().toISOString(),
                prompt: prompt.substring(0, 500), // Limit stored prompt length
                responseLength: response ? response.length : 0,
                ...metadata
            });
            
            // Keep only last 20 queries per day to avoid excessive storage
            if (userToday.queries.length > 20) {
                userToday.queries = userToday.queries.slice(-20);
            }
            
            userData[email][today] = userToday;
            await this.saveUserData(userData);
            
            logger.info('Query recorded', { 
                email, 
                dailyCount: userToday.count, 
                promptLength: prompt.length 
            });
            
        } catch (error) {
            logger.error('Failed to record query', { email, error: error.message });
            // Don't throw error to prevent blocking the query
        }
    }

    async getUserStats(email) {
        try {
            const userData = await this.loadUserData();
            const today = this.getTodayKey();
            
            if (!userData[email]) {
                return {
                    today: { count: 0, queries: [] },
                    totalDays: 0,
                    totalQueries: 0
                };
            }
            
            const userHistory = userData[email];
            const todayData = userHistory[today] || { count: 0, queries: [] };
            
            const totalDays = Object.keys(userHistory).length;
            const totalQueries = Object.values(userHistory).reduce((sum, day) => sum + day.count, 0);
            
            return {
                today: todayData,
                totalDays,
                totalQueries,
                recentDays: Object.entries(userHistory)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .slice(0, 7)
                    .map(([date, data]) => ({ date, count: data.count }))
            };
        } catch (error) {
            logger.error('Failed to get user stats', { email, error: error.message });
            return { error: 'Failed to load stats' };
        }
    }

    async cleanupOldData(daysToKeep = 30) {
        try {
            const userData = await this.loadUserData();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            const cutoffKey = cutoffDate.toISOString().split('T')[0];
            
            let cleanedCount = 0;
            
            for (const email in userData) {
                const userHistory = userData[email];
                for (const dateKey in userHistory) {
                    if (dateKey < cutoffKey) {
                        delete userHistory[dateKey];
                        cleanedCount++;
                    }
                }
                
                // Remove users with no data
                if (Object.keys(userHistory).length === 0) {
                    delete userData[email];
                }
            }
            
            await this.saveUserData(userData);
            logger.info('Cleaned up old user data', { cleanedCount, daysToKeep });
            
            return { cleanedCount };
        } catch (error) {
            logger.error('Failed to cleanup old data', { error: error.message });
            throw error;
        }
    }

    // Admin methods
    async updateDailyLimit(newLimit) {
        if (typeof newLimit !== 'number' || newLimit < 1) {
            throw new Error('Daily limit must be a positive number');
        }
        
        this.config.dailyQueryLimit = newLimit;
        
        // Update environment variable (for current session)
        process.env.DAILY_QUERY_LIMIT = newLimit.toString();
        
        logger.info('Daily query limit updated', { newLimit });
        return { success: true, newLimit };
    }

    async getAllUserStats() {
        try {
            const userData = await this.loadUserData();
            const today = this.getTodayKey();
            
            const stats = {};
            for (const email in userData) {
                const userHistory = userData[email];
                const todayData = userHistory[today] || { count: 0 };
                
                stats[email] = {
                    todayCount: todayData.count,
                    totalDays: Object.keys(userHistory).length,
                    totalQueries: Object.values(userHistory).reduce((sum, day) => sum + day.count, 0),
                    lastActivity: Math.max(...Object.values(userHistory).map(day => 
                        day.lastQuery ? new Date(day.lastQuery).getTime() : 0
                    ))
                };
            }
            
            return stats;
        } catch (error) {
            logger.error('Failed to get all user stats', { error: error.message });
            throw error;
        }
    }

    getCurrentConfig() {
        return {
            dailyQueryLimit: this.config.dailyQueryLimit,
            adminEmails: this.config.adminEmails,
            dataFile: this.config.dataFile
        };
    }
}

export { UserService };