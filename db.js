// db.js
// This file creates one reusable connection to your MySQL database

require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
    host     : process.env.DB_HOST,
    user     : process.env.DB_USER,
    password : process.env.DB_PASSWORD,
    database : process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    console.log('✅ Connected to CampusBridge MySQL database.');
});

module.exports = db;