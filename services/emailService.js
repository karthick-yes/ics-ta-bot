import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Logger } from '../logger.js';
dotenv.config();

const logger = new Logger();

class EmailService {
    constructor() {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            logger.error('Email credentials not configured');
            throw new Error('EMAIL_USER and EMAIL_PASS must be set in environment variables');
        }

        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Test connection on initialization
        this.testConnection();
    }

    async testConnection() {
        try {
            await this.transporter.verify();
            logger.info('Email service connected successfully', { 
                user: process.env.EMAIL_USER?.replace(/@.*$/, '@***') 
            });
        } catch (error) {
            logger.error('Email service connection failed', { error: error.message });
        }
    }

    async sendVerificationCode(email, code) {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your ICS TA Bot Verification Code",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #333; border-bottom: 2px solid #007bff;">ICS TA Bot Verification</h2>
                    <p>Your verification code is:</p>
                    <div style="background: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
                        <span style="font-size: 24px; font-weight: bold; color: #007bff; letter-spacing: 3px;">${code}</span>
                    </div>
                    <p style="color: #666;">This code will expire in 10 minutes.</p>
                    <p style="color: #666; font-size: 0.9em;">If you didn't request this code, please ignore this email.</p>
                </div>
            `
        };

        try {
            await this.transporter.sendMail(mailOptions);
            logger.info('Verification email sent', { to: email });
            return true;
        } catch (error) {
            logger.error('Failed to send verification email', { to: email, error: error.message });
            return false;
        }
    }

    async sendEmail(to, subject, htmlContent, textContent = null) {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            html: htmlContent
        };

        if (textContent) {
            mailOptions.text = textContent;
        }

        try {
            const result = await this.transporter.sendMail(mailOptions);
            logger.info('Email sent successfully', { 
                to: to, 
                subject: subject,
                messageId: result.messageId 
            });
            return { success: true, messageId: result.messageId };
        } catch (error) {
            logger.error('Failed to send email', { 
                to: to, 
                subject: subject, 
                error: error.message 
            });
            throw error;
        }
    }

    async sendFeedbackReport(adminEmail, report) {
        const subject = `🚨 ICS TA Bot Attack Report - ${report.attackType} (${report.priority.toUpperCase()})`;
        
        // This method would use the HTML generation from FeedbackService
        // but is kept here for compatibility
        try {
            return await this.sendEmail(adminEmail, subject, report.htmlContent);
        } catch (error) {
            logger.error('Failed to send feedback report', { 
                adminEmail, 
                reportId: report.id, 
                error: error.message 
            });
            throw error;
        }
    }

    // Batch email sending with rate limiting
    async sendBatchEmails(emails, subject, htmlContent, delayMs = 1000) {
        const results = [];
        
        for (let i = 0; i < emails.length; i++) {
            try {
                const result = await this.sendEmail(emails[i], subject, htmlContent);
                results.push({ email: emails[i], success: true, result });
                
                // Add delay to avoid rate limiting
                if (i < emails.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            } catch (error) {
                results.push({ email: emails[i], success: false, error: error.message });
            }
        }
        
        logger.info('Batch email sending completed', { 
            total: emails.length, 
            successful: results.filter(r => r.success).length 
        });
        
        return results;
    }
}

export default new EmailService();