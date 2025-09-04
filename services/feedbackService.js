import { Logger } from '../logger.js';
import EmailService from './emailService.js';
import authService from './authService.js';
import { redisClient } from '../redisClient.js';
// add REST APIs for all the admin friendly functions to the server code


const logger = new Logger();

class FeedbackService {
    constructor() {
        this.config = {
            adminEmails: [] 
        };
        // Define a single key for our list of feedback reports in Redis.
        this.reportsKey = 'feedback_reports';
    }
    // initialize this later in the server code.   
    async init() {
        const redisAdmins = await authService.getAdminlist();

        if (redisAdmins && redisAdmins.length > 0){
            this.config.adminEmails = redisAdmins;
        } else {
            this.config.adminEmails = (process.env.ADMIN_EMAILS || process.env.EMAIL_USER || '')
                .split(',')
                .map(email => email.trim())
                .filter(Boolean);
        }
    }

    async isAdmin(email) {
        return await authService.isEmailAdmin(email);
    }

    /**
     * Submits new feedback, storing it in Redis.
     * @param {string} userEmail - The user submitting feedback.
     * @param {string} attackType - The category of feedback.
     * @param {string} description - The feedback text.
     * @param {Array} conversationHistory - The chat history.
     * @returns {object} - A success object with the report ID.
     */
    async submitFeedback(userEmail, attackType, description, conversationHistory = []) {
        try {
            if (!userEmail || !attackType || !description) {
                throw new Error('User email, attack type, and description are required');
            }

            const report = {
                id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                userEmail,
                attackType,
                description,
                conversationHistory: this.formatConversationForReport(conversationHistory),
                status: 'pending',
                priority: this.determinePriority(attackType)
            };

            // Convert the report object to a JSON string.
            const reportJson = JSON.stringify(report);

            // LPUSH adds the new report to the beginning of the list.
            await redisClient.lPush(this.reportsKey, reportJson);
            
            // LTRIM keeps the list at a maximum size (e.g., 1000 reports) to prevent
            // it from growing forever. It keeps the items from index 0 to 999.
            await redisClient.lTrim(this.reportsKey, 0, 999);

            await this.sendFeedbackNotification(report);

            logger.info('Feedback report submitted to Redis', {
                reportId: report.id,
                userEmail,
            });

            return {
                success: true,
                reportId: report.id,
                message: 'Thank you for your feedback. The report has been submitted.'
            };

        } catch (error) {
            logger.error('Failed to submit feedback to Redis', { userEmail, error: error.message });
            throw error;
        }
    }

    /**
     * Retrieves all feedback reports from Redis.
     * @param {number} limit - The maximum number of reports to retrieve.
     * @returns {Array} - An array of report objects.
     */
    async getAllReports(limit = 50, status = null) {
        try {
            // LRANGE retrieves all elements to filter them in the app.
            const reportStrings = await redisClient.lRange(this.reportsKey, 0, -1);
            let reports = reportStrings.map(reportJson => JSON.parse(reportJson));

            if (status) {
                reports = reports.filter(report => report.status === status);
            }

            // The list is already sorted newest first due to LPUSH.
            return reports.slice(0, limit);
        } catch (error) {
            logger.error('Failed to get all reports from Redis', { error: error.message });
            throw error;
        }
    }

    /**
     * Updates the status of a specific report.
     * @param {string} reportId - The ID of the report to update.
     * @param {string} status - The new status.
     * @param {string} adminEmail - The email of the admin making the change.
     * @returns {object} - A success object.
     */
    async updateReportStatus(reportId, status, adminEmail) {
        try {
            const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
            }

            const reportStrings = await redisClient.lRange(this.reportsKey, 0, -1);
            const reports = reportStrings.map(r => JSON.parse(r));
            const reportIndex = reports.findIndex(r => r.id === reportId);

            if (reportIndex === -1) {
                throw new Error('Report not found');
            }

            // Update the report object
            reports[reportIndex].status = status;
            reports[reportIndex].updatedAt = new Date().toISOString();
            reports[reportIndex].updatedBy = adminEmail;

            // LSET updates an element at a specific index in the list.
            await redisClient.lSet(this.reportsKey, reportIndex, JSON.stringify(reports[reportIndex]));

            logger.info('Report status updated in Redis', { reportId, status, adminEmail });

            return { success: true, reportId, newStatus: status };
        } catch (error) {
            logger.error('Failed to update report status in Redis', { reportId, error: error.message });
            throw error;
        }
    }

    /**
     * Gathers statistics about all feedback reports.
     * @returns {object} - An object containing report statistics.
     */
    async getReportStats() {
        try {
            const reportStrings = await redisClient.lRange(this.reportsKey, 0, -1);
            const reports = reportStrings.map(r => JSON.parse(r));

            const stats = {
                total: reports.length,
                byStatus: {},
                byType: {},
                byPriority: {},
                recent: reports.filter(r =>
                    new Date(r.timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                ).length
            };

            reports.forEach(report => {
                stats.byStatus[report.status] = (stats.byStatus[report.status] || 0) + 1;
                stats.byType[report.attackType] = (stats.byType[report.attackType] || 0) + 1;
                stats.byPriority[report.priority] = (stats.byPriority[report.priority] || 0) + 1;
            });

            return stats;
        } catch (error) {
            logger.error('Failed to get report stats from Redis', { error: error.message });
            throw error;
        }
    }

    // --- Helper Methods ---

    formatConversationForReport(history) {
        if (!Array.isArray(history)) {
            logger.warn('Conversation history is not an array', { historyType: typeof history });
            return [];
        }
        const formatted = history.map((message, index) => {
            let content = '';
            let role = 'unknown';
            if (message && typeof message === 'object') {
                role = message.role === 'user' ? 'user' : 'model';
                content = message.parts?.map(p => p.text).join('\n') || message.content || '';
            }
            return { index: index + 1, role, content: content.trim(), timestamp: message.timestamp || new Date().toISOString() };
        }).filter(msg => msg.content.length > 0);
        return formatted.slice(-10); // Keep only last 10 messages
    }

    determinePriority(attackType) {
        const highPriorityTypes = ['jailbreak_attempt', 'prompt_injection', 'system_manipulation'];
        const mediumPriorityTypes = ['answer_seeking', 'academic_dishonesty'];
        if (highPriorityTypes.includes(attackType)) return 'high';
        if (mediumPriorityTypes.includes(attackType)) return 'medium';
        return 'low';
    }

    async sendFeedbackNotification(report) {
        try {
            if (this.config.adminEmails.length === 0) {
                logger.warn('No admin emails configured for feedback notifications');
                return;
            }
            const subject = `🚨 ICS TA Bot Report - ${report.attackType} (${report.priority.toUpperCase()})`;
            const htmlContent = this.generateEmailContent(report);
            for (const adminEmail of this.config.adminEmails) {
                await EmailService.sendEmail(adminEmail, subject, htmlContent);
            }
            logger.info('Feedback notification sent', { reportId: report.id });
        } catch (error) {
            logger.error('Failed to send feedback notification', { reportId: report.id, error: error.message });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\n/g, '<br>');
    }

    generateEmailContent(report) {
        const priorityColor = { high: '#dc3545', medium: '#ffc107', low: '#28a745' };
        let conversationHtml = report.conversationHistory?.map(msg => {
            const roleColor = msg.role === 'user' ? '#e3f2fd' : '#f3e5f5';
            const roleLabel = msg.role === 'user' ? '👤 Student' : '🤖 Bot';
            return `
                <div style="margin: 15px 0; padding: 15px; background: ${roleColor}; border-radius: 8px; border-left: 4px solid ${msg.role === 'user' ? '#2196f3' : '#9c27b0'};">
                    <div style="font-weight: bold; color: #333;">${roleLabel}</div>
                    <div style="white-space: pre-wrap; word-wrap: break-word; margin-top: 5px;">${this.escapeHtml(msg.content)}</div>
                </div>`;
        }).join('') || '<p>No conversation history available.</p>';

        return `
            <body style="font-family: Arial, sans-serif; line-height: 1.6;">
                <div style="max-width: 800px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h1 style="color: ${priorityColor[report.priority]};">🚨 ICS TA Bot Report</h1>
                    <p><strong>Report ID:</strong> ${report.id}</p>
                    <p><strong>Timestamp:</strong> ${new Date(report.timestamp).toLocaleString()}</p>
                    <p><strong>User:</strong> ${report.userEmail}</p>
                    <p><strong>Type:</strong> ${report.attackType}</p>
                    <p><strong>Priority:</strong> ${report.priority.toUpperCase()}</p>
                    <hr>
                    <h3>Description</h3>
                    <p>${this.escapeHtml(report.description)}</p>
                    <h3>Conversation History (Last ${report.conversationHistory?.length || 0} messages)</h3>
                    ${conversationHtml}
                </div>
            </body>`;
    }
}

export { FeedbackService };
