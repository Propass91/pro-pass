const { getDb } = require('../database/database');

class AuthService {
  login(username, password) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM clients WHERE username = ? AND password = ? AND is_active = 1');
    const user = stmt.get(username, password);
    
    if (!user) {
      return { success: false, error: 'Identifiants invalides' };
    }
    
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
        site_id: user.site_id,
        monthly_limit: user.monthly_limit
      }
    };
  }
}

module.exports = { authService: new AuthService() };
