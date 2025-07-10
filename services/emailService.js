import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();


class Emailservice{
    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }


    async sendVerificationCode(email, code) {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your ICS TA Bot Verification Code",
            html: `
                <h2>Verification Code </h2>
                <p>Your verification code is: <strong>${code}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        };
        try {
            await this.transporter.sendMail(mailOptions);
            console.log('Verification email sent to:', email);
            return true;
        } catch (error) {
            console.error('Error sending email:', error);
            return false;
        }
    }


}

export default new Emailservice();