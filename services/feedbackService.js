import { Logger } from '../logger.js';
import EmailService from './emailService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger();

class FeedbackService {
    constructor() {
        this.config = {
            adminEmails: (process.env.ADMIN_EMAILS || process.env.EMAIL_USER || '').split(',').map(email => email.trim()).filter(Boolean),
            feedbackFile: path.join(__dirname, '../data/feedback_reports.json')
        };
        
        this.ensureDataDirectory();
    }

    async ensureDataDirectory() {
        try {
            const dataDir = path.dirname(this.config.feedbackFile);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            logger.error('Failed to create feedback data directory', { error: error.message });
        }
    }

    async loadFeedbackData() {
        try {
            const data = await fs.readFile(this.config.feedbackFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { reports: [] };
            }
            logger.error('Failed to load feedback data', { error: error.message });
            return { reports: [] };
        }
    }

    async saveFeedbackData(data) {
        try {
            await fs.writeFile(this.config.feedbackFile, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error('Failed to save feedback data', { error: error.message });
            throw error;
        }
    }

    async submitFeedback(userEmail, attackType, description, conversationHistory = []) {
        try {
            if (!userEmail || !attackType || !description) {
                throw new Error('User email, attack type, and description are required');
            }

            const feedbackData = await this.loadFeedbackData();
            
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

            feedbackData.reports.push(report);
            await this.saveFeedbackData(feedbackData);

            // Send email notification to admins
            await this.sendFeedbackNotification(report);

            logger.info('Feedback report submitted', { 
                reportId: report.id, 
                userEmail, 
                attackType,
                conversationLength: report.conversationHistory.length // Debug info
            });

            return {
                success: true,
                reportId: report.id,
                message: 'Thank you for your feedback. The report has been submitted and administrators have been notified.'
            };

        } catch (error) {
            logger.error('Failed to submit feedback', { userEmail, error: error.message });
            throw error;
        }
    }

    formatConversationForReport(history) {
        if (!Array.isArray(history)) {
            logger.warn('Conversation history is not an array', { historyType: typeof history, history });
            return [];
        }
        
        const formatted = history.map((message, index) => {
            // Handle different possible message formats
            let content = '';
            let role = 'unknown';
            
            if (typeof message === 'string') {
                content = message;
                role = index % 2 === 0 ? 'user' : 'model';
            } else if (message && typeof message === 'object') {
                // Handle Gemini format
                if (message.role) {
                    role = message.role === 'user' ? 'user' : 'model';
                }
                
                // Extract content from various formats
                if (message.content) {
                    content = message.content;
                } else if (message.parts && Array.isArray(message.parts)) {
                    content = message.parts.map(part => part.text || part).join(' ');
                } else if (message.text) {
                    content = message.text;
                } else if (message.message) {
                    content = message.message;
                } else {
                    content = JSON.stringify(message);
                }
            }
            
            return {
                index: index + 1,
                role,
                content: content.toString().trim(),
                timestamp: message.timestamp || new Date().toISOString()
            };
        }).filter(msg => msg.content.length > 0); // Remove empty messages
        
        logger.info('Formatted conversation history', { 
            originalLength: history.length, 
            formattedLength: formatted.length 
        });
        
        return formatted.slice(-10); // Keep only last 10 messages
    }

    determinePriority(attackType) {
        const highPriorityTypes = [
            'jailbreak_attempt',
            'prompt_injection',
            'inappropriate_content_generation',
            'system_manipulation'
        ];
        
        const mediumPriorityTypes = [
            'answer_seeking',
            'hint_solicitation',
            'academic_dishonesty'
        ];

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

            const subject = `🚨 ICS TA Bot Attack Report - ${report.attackType} (${report.priority.toUpperCase()})`;
            
            const htmlContent = this.generateEmailContent(report);

            for (const adminEmail of this.config.adminEmails) {
                await EmailService.sendEmail(
                    adminEmail,
                    subject,
                    htmlContent
                );
            }

            logger.info('Feedback notification sent', { 
                reportId: report.id, 
                adminCount: this.config.adminEmails.length,
                conversationMessages: report.conversationHistory.length
            });

        } catch (error) {
            logger.error('Failed to send feedback notification', { 
                reportId: report.id, 
                error: error.message 
            });
            // Don't throw error - feedback was still recorded
        }
    }

    generateEmailContent(report) {
        const priorityColor = {
            high: '#dc3545',
            medium: '#ffc107',
            low: '#28a745'
        };

        // Debug logging
        logger.info('Generating email content', { 
            reportId: report.id,
            conversationHistoryLength: report.conversationHistory?.length || 0,
            conversationHistory: report.conversationHistory
        });

        let conversationHtml = '';
        
        if (report.conversationHistory && report.conversationHistory.length > 0) {
            conversationHtml = report.conversationHistory.map(msg => {
                const roleColor = msg.role === 'user' ? '#e3f2fd' : '#f3e5f5';
                const roleLabel = msg.role === 'user' ? '👤 Student' : '🤖 Bot';
                
                return `
                    <div style="margin: 15px 0; padding: 15px; background: ${roleColor}; border-radius: 8px; border-left: 4px solid ${msg.role === 'user' ? '#2196f3' : '#9c27b0'};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <strong style="color: #333;">${roleLabel} (Message ${msg.index})</strong>
                            <small style="color: #666;">${new Date(msg.timestamp).toLocaleString()}</small>
                        </div>
                        <div style="white-space: pre-wrap; word-wrap: break-word; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.4;">
                            ${this.escapeHtml(msg.content)}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            conversationHtml = '<p style="color: #666; font-style: italic;">No conversation history available.</p>';
        }

        return `
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>ICS TA Bot Attack Report</title>
            </head>
            <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
                <div style="max-width: 800px; margin: 20px auto; background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, ${priorityColor[report.priority]}, ${priorityColor[report.priority]}dd); color: white; padding: 20px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">🚨 ICS TA Bot Attack Report</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9;">Priority: ${report.priority.toUpperCase()}</p>
                    </div>
                    
                    <div style="padding: 20px;">
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
                            <h2 style="margin-top: 0; color: #333;">📋 Report Details</h2>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 8px 0; font-weight: bold; width: 120px;">Report ID:</td><td style="padding: 8px 0;">${report.id}</td></tr>
                                <tr><td style="padding: 8px 0; font-weight: bold;">Timestamp:</td><td style="padding: 8px 0;">${new Date(report.timestamp).toLocaleString()}</td></tr>
                                <tr><td style="padding: 8px 0; font-weight: bold;">User Email:</td><td style="padding: 8px 0;">${report.userEmail}</td></tr>
                                <tr><td style="padding: 8px 0; font-weight: bold;">Attack Type:</td><td style="padding: 8px 0;"><span style="color: ${priorityColor[report.priority]}; font-weight: bold;">${report.attackType}</span></td></tr>
                                <tr><td style="padding: 8px 0; font-weight: bold;">Messages:</td><td style="padding: 8px 0;">${report.conversationHistory?.length || 0} conversation messages</td></tr>
                            </table>
                        </div>

                        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                            <h3 style="margin-top: 0; color: #856404;">📝 Description</h3>
                            <div style="white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(report.description)}</div>
                        </div>

                        <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
                            <h3 style="margin-top: 0; color: #0c5460;">💬 Conversation History</h3>
                            <p style="margin-bottom: 15px; color: #666; font-size: 14px;">Last ${Math.min(10, report.conversationHistory?.length || 0)} messages from the conversation:</p>
                            ${conversationHtml}
                        </div>

                        <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
                            <h3 style="margin-top: 0; color: #155724;">🔍 Next Steps</h3>
                            <ul style="margin: 0; padding-left: 20px;">
                                <li>Review the conversation for attack patterns</li>
                                <li>Consider if system prompts need updates</li>
                                <li>Evaluate if user needs additional guidance</li>
                                <li>Update the attack report status in the system</li>
                                <li>Document any new attack vectors discovered</li>
                            </ul>
                        </div>
                    </div>

                    <div style="background: #f8f9fa; padding: 15px 20px; border-top: 1px solid #dee2e6; text-align: center; color: #666; font-size: 12px;">
                        <p style="margin: 0;">
                            This is an automated report from the ICS TA Bot system.<br>
                            Report ID: ${report.id} | Generated: ${new Date().toLocaleString()}
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    // Fixed escapeHtml function
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

    // Admin methods
    async getAllReports(limit = 50, status = null) {
        try {
            const feedbackData = await this.loadFeedbackData();
            let reports = feedbackData.reports || [];

            if (status) {
                reports = reports.filter(report => report.status === status);
            }

            // Sort by timestamp (newest first)
            reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            return reports.slice(0, limit);
        } catch (error) {
            logger.error('Failed to get all reports', { error: error.message });
            throw error;
        }
    }

    async updateReportStatus(reportId, status, adminEmail) {
        try {
            const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
            }

            const feedbackData = await this.loadFeedbackData();
            const reportIndex = feedbackData.reports.findIndex(r => r.id === reportId);

            if (reportIndex === -1) {
                throw new Error('Report not found');
            }

            feedbackData.reports[reportIndex].status = status;
            feedbackData.reports[reportIndex].updatedAt = new Date().toISOString();
            feedbackData.reports[reportIndex].updatedBy = adminEmail;

            await this.saveFeedbackData(feedbackData);

            logger.info('Report status updated', { reportId, status, adminEmail });

            return {
                success: true,
                reportId,
                newStatus: status
            };
        } catch (error) {
            logger.error('Failed to update report status', { reportId, error: error.message });
            throw error;
        }
    }

    async getReportStats() {
        try {
            const feedbackData = await this.loadFeedbackData();
            const reports = feedbackData.reports || [];

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
            logger.error('Failed to get report stats', { error: error.message });
            throw error;
        }
    }
}

export { FeedbackService };