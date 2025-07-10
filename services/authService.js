import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import emailService from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AuthService {
    constructor() {
        this.whitelistPath = path.join(__dirname, '../data/whitelist.json');
        this.tempCodesPath = path.join(__dirname, '../data/temp-codes.json');
        this.ensureDataFiles();
    }

    ensureDataFiles() {
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        if (!fs.existsSync(this.whitelistPath)) {
            fs.writeFileSync(this.whitelistPath, JSON.stringify([]));
        }
        
        if (!fs.existsSync(this.tempCodesPath)) {
            fs.writeFileSync(this.tempCodesPath, JSON.stringify({}));
        }
    }

    getWhitelist() {
        try {
            const data = fs.readFileSync(this.whitelistPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error reading whitelist:', error);
            return [];
        }
    }

    addToWhitelist(email) {
        const whitelist = this.getWhitelist();
        if (!whitelist.includes(email)) {
            whitelist.push(email);
            fs.writeFileSync(this.whitelistPath, JSON.stringify(whitelist, null, 2));
            return true;
        }
        return false;
    }

    removeFromWhitelist(email) {
        const whitelist = this.getWhitelist();
        const index = whitelist.indexOf(email);
        if (index > -1) {
            whitelist.splice(index, 1);
            fs.writeFileSync(this.whitelistPath, JSON.stringify(whitelist, null, 2));
            return true;
        }
        return false;
    }

    isEmailWhitelisted(email) {
        const whitelist = this.getWhitelist();
        return whitelist.includes(email);
    }

    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async requestVerification(email) {
        if (!this.isEmailWhitelisted(email)) {
            throw new Error('Email not authorized');
        }

        const code = this.generateVerificationCode();
        const hashedCode = await bcrypt.hash(code, 10);
        
        // Store temporarily (expires in 10 minutes)
        const tempCodes = this.getTempCodes();
        tempCodes[email] = {
            code: hashedCode,
            expires: Date.now() + 10 * 60 * 1000 // 10 minutes
        };
        
        fs.writeFileSync(this.tempCodesPath, JSON.stringify(tempCodes));
        
        // Send email
        const emailSent = await emailService.sendVerificationCode(email, code);
        if (!emailSent) {
            throw new Error('Failed to send verification email');
        }
        
        return true;
    }

    getTempCodes() {
        try {
            const data = fs.readFileSync(this.tempCodesPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async verifyCode(email, code) {
        const tempCodes = this.getTempCodes();
        const storedData = tempCodes[email];
        
        if (!storedData) {
            throw new Error('No verification code found');
        }
        
        if (Date.now() > storedData.expires) {
            delete tempCodes[email];
            fs.writeFileSync(this.tempCodesPath, JSON.stringify(tempCodes));
            throw new Error('Verification code expired');
        }
        
        const isValid = await bcrypt.compare(code, storedData.code);
        if (!isValid) {
            throw new Error('Invalid verification code');
        }
        
        // Clean up used code
        delete tempCodes[email];
        fs.writeFileSync(this.tempCodesPath, JSON.stringify(tempCodes));
        
        // Generate JWT token
        const token = jwt.sign(
            { email: email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
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