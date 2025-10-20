// server.js - Main Express Server
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'report_portal',
  password: process.env.DB_PASSWORD || 'your_password',
  port: process.env.DB_PORT || 5432,
});
// Auto-create tables if they don't exist
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100) NOT NULL,
        parent_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'submitter', 'internal_approver', 'lga_approver')),
        organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT,
        organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        submitter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL CHECK (status IN ('pending_internal', 'internally_approved', 'approved', 'rejected', 'overdue')),
        due_date DATE NOT NULL,
        submitted_date DATE NOT NULL,
        internal_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        lga_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

initDB();

// Middleware
app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin Middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============================================
// AUTH ROUTES
// ============================================

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        organization_id: user.organization_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// ORGANIZATION ROUTES
// ============================================

// Get all organizations
app.get('/api/organizations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM organizations ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create organization (Admin only)
app.post('/api/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, type, parent_id } = req.body;

    const result = await pool.query(
      'INSERT INTO organizations (name, type, parent_id) VALUES ($1, $2, $3) RETURNING *',
      [name, type, parent_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update organization (Admin only)
app.put('/api/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, parent_id } = req.body;

    const result = await pool.query(
      'UPDATE organizations SET name = $1, type = $2, parent_id = $3 WHERE id = $4 RETURNING *',
      [name, type, parent_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete organization (Admin only)
app.delete('/api/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM organizations WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ message: 'Organization deleted successfully' });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// USER ROUTES
// ============================================

// Get all users (Admin only)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, username, role, organization_id FROM users ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (Admin only)
app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, username, password, role, organization_id } = req.body;

    // Check if username already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, username, password, role, organization_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, username, role, organization_id',
      [name, email, username, hashedPassword, role, organization_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (Admin only)
app.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, username, role, organization_id } = req.body;

    const result = await pool.query(
      'UPDATE users SET name = $1, email = $2, username = $3, role = $4, organization_id = $5 WHERE id = $6 RETURNING id, name, email, username, role, organization_id',
      [name, email, username, role, organization_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password (Admin only)
app.put('/api/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2 RETURNING id',
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user (Admin only)
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// REPORT ROUTES
// ============================================

// Get all reports (filtered by role)
app.get('/api/reports', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM reports';
    let params = [];

    if (req.user.role === 'submitter') {
      query += ' WHERE submitter_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'internal_approver') {
      query += ' WHERE organization_id IN (SELECT organization_id FROM users WHERE id = $1)';
      params.push(req.user.id);
    } else if (req.user.role === 'lga_approver') {
      query += ' WHERE organization_id IN (SELECT id FROM organizations WHERE parent_id IN (SELECT organization_id FROM users WHERE id = $1))';
      params.push(req.user.id);
    }

    query += ' ORDER BY submitted_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create report (Submitters)
app.post('/api/reports', authenticateToken, async (req, res) => {
  try {
    const { title, content, due_date } = req.body;
    const submitter_id = req.user.id;

    // Get user's organization
    const userResult = await pool.query(
      'SELECT organization_id FROM users WHERE id = $1',
      [submitter_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'User organization not found' });
    }

    const organization_id = userResult.rows[0].organization_id;

    const result = await pool.query(
      'INSERT INTO reports (title, content, organization_id, submitter_id, status, due_date, submitted_date) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING *',
      [title, content, organization_id, submitter_id, 'pending_internal', due_date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve report
app.put('/api/reports/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { approval_type } = req.body; // 'internal' or 'lga'

    let newStatus, approverField;

    if (approval_type === 'internal') {
      newStatus = 'internally_approved';
      approverField = 'internal_approver_id';
    } else if (approval_type === 'lga') {
      newStatus = 'approved';
      approverField = 'lga_approver_id';
    } else {
      return res.status(400).json({ error: 'Invalid approval type' });
    }

    const result = await pool.query(
      `UPDATE reports SET status = $1, ${approverField} = $2 WHERE id = $3 RETURNING *`,
      [newStatus, req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Approve report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reject report
app.put('/api/reports/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE reports SET status = $1 WHERE id = $2 RETURNING *',
      ['rejected', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Reject report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete report (Admin only)
app.delete('/api/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM reports WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});