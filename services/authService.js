import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import emailService from './emailService.js';
import { redisClient } from '../redisClient.js';

//kept redis for the following: if the admin panel wants to add admin-emails dynamically then redis will be a good use case.
// Authservice class implementation
class AuthService {
    constructor() {

        this.tempCodes = {};
        this.whitelistKey = 'whitelisted_emails';
        this.adminEmails = 'admin_emails';
    }

    async getAdminlist(){
        const result = await redisClient.sMembers(this.adminEmails);
        if (result.length == 0){
            console.log('No existing admin email list initialized');
        }
        return result;
    }


    async getWhitelist() {
        const result = await redisClient.sMembers(this.whitelistKey);
        if (result.length == 0){
            console.log(`No existing whitelist to be retrieved`);
        }
        return result;
    }

    async addToWhitelist(email) {
        const result = await redisClient.SADD(this.whitelistKey, email);
        if (result == 1) {
            console.log(`Adding ${email} to the whitelist.`)
        }
        return result === 1; 
    }

    async removeFromWhitelist(email) {
        const result = await redisClient.SREM(this.whitelistKey, email);
        if (result == 1) {
            console.log(`Removing ${email} from the whitelist.`)
        }
        return result === 1; 
    }

    async isEmailWhitelisted(email) {
        const result = await redisClient.sIsMember(this.whitelistKey, email);
        if (result == 1) {
            console.log(`${email} is whitelisted.`)
        }
        
        return result === 1;
    }

    async isEmailAdmin(email){
        const result = await redisClient.sIsMember(this.adminEmails, email)
        if (result == 1) {
            console.log(`${email} is an Admin email.`)
        }

        return result === 1;
    }


    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async requestVerification(email) {
        // for any  user even the admin, we need to request for verification
        console.log(`Verification requested for: ${email}`);
        const count = await redisClient.SCARD(this.whitelistKey);
        console.log(`Current whitelist has ${count} emails`);
        
        if (!(await this.isEmailWhitelisted(email))) {
            console.warn(`Email not authorized: ${email}`);
            throw new Error('Email not authorized');
        }

        const code = this.generateVerificationCode();
        const hashedCode = await bcrypt.hash(code, 10);
        
        // Store temporarily (expires in 10 minutes)
        this.tempCodes[email] = {
            code: hashedCode,
            expires: Date.now() + 10 * 60 * 1000 // 10 minutes
        };
        
        console.log(`Generated verification code for ${email}`);
        
        // Send email
        const emailSent = await emailService.sendVerificationCode(email, code);
        if (!emailSent) {
            throw new Error('Failed to send verification email');
        }
        
        console.log(`Verification email sent to ${email}`);
        return true;
    }

    getTempCodes() {
        return this.tempCodes;
    }

    async verifyCode(email, code) {
        console.log(`Verifying code for: ${email}`);
        
        const storedData = this.tempCodes[email];
        
        if (!storedData) {
            console.log(`No verification code found for: ${email}`);
            throw new Error('No verification code found');
        }
        
        if (Date.now() > storedData.expires) {
            delete this.tempCodes[email];
            console.log(`Verification code expired for: ${email}`);
            throw new Error('Verification code expired');
        }
        
        const isValid = await bcrypt.compare(code, storedData.code);
        if (!isValid) {
            console.log(`Invalid verification code for: ${email}`);
            throw new Error('Invalid verification code');
        }
        
        // Clean up used code
        delete this.tempCodes[email];

        const isAdmin = await this.isEmailAdmin(email);          
        // Generate JWT token
        const token = jwt.sign(
            { email: email,
                role: isAdmin ? "admin" : "user"
             },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`Successfully verified and generated token for: ${email}`);
        return token;
    }

    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return decoded;
        } catch (error) {
            throw new Error('Invalid token');
        }
    }
}

export default new AuthService();