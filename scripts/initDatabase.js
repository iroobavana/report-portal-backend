// scripts/initDatabase.js - Initialize Database with Sample Data
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'report_portal',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function initDatabase() {
  try {
    console.log('🔄 Initializing database...');

    // Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const johnPassword = await bcrypt.hash('john123', 10);
    const sarahPassword = await bcrypt.hash('sarah123', 10);
    const ahmedPassword = await bcrypt.hash('ahmed123', 10);

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await pool.query('TRUNCATE TABLE reports, users, organizations RESTART IDENTITY CASCADE');

    // Insert Organizations
    console.log('🏢 Creating organizations...');
    const orgResult = await pool.query(`
      INSERT INTO organizations (name, type, parent_id) VALUES
      ('Male City Council', 'LGA', NULL),
      ('Addu City Council', 'Atoll Council', NULL),
      ('Health Department - Male', 'Department', 1),
      ('Education Department - Male', 'Department', 1)
      RETURNING id, name
    `);
    console.log(`✅ Created ${orgResult.rows.length} organizations`);

    // Insert Users
    console.log('👥 Creating users...');
    const userResult = await pool.query(`
      INSERT INTO users (name, email, username, password, role, organization_id) VALUES
      ('Admin User', 'admin@portal.gov', 'admin', $1, 'admin', NULL),
      ('John Submitter', 'john@health.gov', 'john', $2, 'submitter', 3),
      ('Sarah Approver', 'sarah@health.gov', 'sarah', $3, 'internal_approver', 3),
      ('Ahmed LGA', 'ahmed@male.gov', 'ahmed', $4, 'lga_approver', 1)
      RETURNING id, username, role
    `, [adminPassword, johnPassword, sarahPassword, ahmedPassword]);
    console.log(`✅ Created ${userResult.rows.length} users`);

    // Insert Sample Reports
    console.log('📄 Creating sample reports...');
    const reportResult = await pool.query(`
      INSERT INTO reports (title, content, organization_id, submitter_id, status, due_date, submitted_date) VALUES
      ('Monthly Health Report - September', 'Comprehensive health statistics for September 2025...', 3, 2, 'pending_internal', '2025-10-25', '2025-10-15'),
      ('Quarterly Budget Report', 'Budget analysis and expenditure report for Q3 2025...', 3, 2, 'internally_approved', '2025-10-30', '2025-10-10'),
      ('Annual Performance Report', 'Year-end performance review and achievements...', 4, 2, 'approved', '2025-10-20', '2025-10-05')
      RETURNING id, title
    `);
    console.log(`✅ Created ${reportResult.rows.length} reports`);

    console.log('\n✨ Database initialized successfully!\n');
    console.log('📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin:             username: admin    password: admin123');
    console.log('Submitter:         username: john     password: john123');
    console.log('Internal Approver: username: sarah    password: sarah123');
    console.log('LGA Approver:      username: ahmed    password: ahmed123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

initDatabase();