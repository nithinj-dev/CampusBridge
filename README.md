# CampusBridge

A mentor-booking platform built with Express, MySQL, and a static front-end.

## Setup (first time on any machine)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create the database**
   - Open MySQL Workbench (or the CLI) and create a database:
     ```sql
     CREATE DATABASE project;
     ```
   - Import the schema and stored procedures:
     ```bash
     mysql -u root -p project < schema.sql
     ```

3. **Configure environment variables**
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and fill in your own local MySQL username/password.

4. **Run the server**
   ```bash
   node server.js
   ```
   The app will be available at `http://localhost:3000`.

## Notes
- `.env` is git-ignored — each person sets their own DB credentials locally, they're never committed.
- `node_modules/` is git-ignored — always run `npm install` after cloning.
- The database schema (tables + stored procedures `book_session` and `confirm_and_award_points`) lives in `schema.sql`, exported separately from the code.