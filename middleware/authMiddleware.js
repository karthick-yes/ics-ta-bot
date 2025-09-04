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
    //check if the user is authenticated plus the admin privilages.
    requireAuth(req, res, () => {
        if (req.user && req.user.role == 'admin') {
            next();
        } else {
            return res.status(403).json({error: 'Admin Privileges required'});
        }
    });
}