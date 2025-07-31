import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import emailService from './emailService.js';

// You can use PostgreSQL, MongoDB, or even a simple SQLite with better persistence
// This example shows the structure - replace with your chosen database

class AuthService {
    constructor() {
        this.initializeWithStaticWhitelist();
    }

    // Temporary solution: Initialize with hardcoded whitelist
    initializeWithStaticWhitelist() {
        this.staticWhitelist = [
            'ics.learning.ashoka@gmail.com',
            'aalok.thakkar@ashoka.edu.in',
            'aadi.grover_ug2024@ashoka.edu.in',
            'adityaveer.dahiya_ug25@ashoka.edu.in',
            'anushka.garimella_ug2024@ashoka.edu.in',
            'aryan.gupta_ug2024@ashoka.edu.in',
            'cian.chengappa_ug2024@ashoka.edu.in',
            'denzel.chinda_ug2024@ashoka.edu.in',
            'fateh.gyani_ug25@ashoka.edu.in',
            'joanne.korah_ug2024@ashoka.edu.in',
            'keerthana.panchanathan_ug25@ashoka.edu.in',
            'larry.tayenjam_ug2024@ashoka.edu.in',
            'lerno.parion_ug2024@ashoka.edu.in',
            'madhurima.banerjee_ug2023@ashoka.edu.in',
            'megha.mudakkayil_ug2024@ashoka.edu.in',
            'mohammad.rahman_ug2024@ashoka.edu.in',
            'monika.pandey_ug2024@ashoka.edu.in',
            'munashe.nyagono_ug2024@ashoka.edu.in',
            'naman.anshumaan_ug2024@ashoka.edu.in',
            'raj.karan_ug2024@ashoka.edu.in',
            'samyak.khobragade_ug2024@ashoka.edu.in',
            'shristi.sharma_ug2024@ashoka.edu.in',
            'surya.singh_ug2023@ashoka.edu.in',
            'vedant.rana_ug2023@ashoka.edu.in',
            'velpula.raju_ug2024@ashoka.edu.in',
            'yashita.mishra_ug2024@ashoka.edu.in',
            'charchit.agarwal_ug2023@ashoka.edu.in',
            'vedant.gautam_ug2023@ashoka.edu.in'
        ];
        
        // In-memory storage for temp codes (will reset on restart, but that's ok for temp codes)
        this.tempCodes = {};
    }

    getWhitelist() {
        return this.staticWhitelist;
    }

    addToWhitelist(email) {
        if (!this.staticWhitelist.includes(email)) {
            this.staticWhitelist.push(email);
            console.log(`Added to whitelist: ${email}`);
            return true;
        }
        return false;
    }

    removeFromWhitelist(email) {
        const index = this.staticWhitelist.indexOf(email);
        if (index > -1) {
            this.staticWhitelist.splice(index, 1);
            console.log(`Removed from whitelist: ${email}`);
            return true;
        }
        return false;
    }

    isEmailWhitelisted(email) {
        const isWhitelisted = this.staticWhitelist.includes(email);
        console.log(`Checking whitelist for ${email}: ${isWhitelisted}`);
        return isWhitelisted;
    }

    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async requestVerification(email) {
        console.log(`Verification requested for: ${email}`);
        console.log(`Current whitelist has ${this.staticWhitelist.length} emails`);
        
        if (!this.isEmailWhitelisted(email)) {
            console.log(`Email not authorized: ${email}`);
            console.log(`Available emails: ${this.staticWhitelist.slice(0, 3).join(', ')}...`);
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
        
        // Generate JWT token
        const token = jwt.sign(
            { email: email },
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