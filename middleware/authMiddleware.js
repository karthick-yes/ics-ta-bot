import authService from '../services/authService.js';

export function requireAuth(req, res, next) {
    const token = req.session.authToken || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decoded = authService.verifyToken(token);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid authentication token' });
    }
}

export function requireAdmin(req, res, next) {
    // You can extend this to check for admin privileges
    // For now, we'll just check if they're authenticated
    requireAuth(req, res, next);
}