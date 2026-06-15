const express = require('express');
const cors    = require('cors');
const db      = require('./db');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ROUTE 1: Get all mentors (UPDATED FOR FILTERS & NO HOURLY RATE)
app.get('/api/mentors', (req, res) => {
    const { country, uni_id } = req.query; // Grab filters from the URL
    
    let query = `
        SELECT 
            u.User_ID, u.Fname, u.Lname, u.Country,
            mp.Mentor_ID, mp.Degree_Name, mp.Grad_Year, mp.Bio,
            un.Uni_Name, un.City, un.Uni_ID,
            (SELECT IFNULL(ROUND(AVG(b.Rating), 1), 0) 
             FROM Bookings b JOIN Availability_Slots s ON b.Slot_ID = s.Slot_ID 
             WHERE s.Mentor_ID = mp.Mentor_ID AND b.Rating IS NOT NULL) AS Avg_Rating,
            (SELECT COUNT(b.Rating) 
             FROM Bookings b JOIN Availability_Slots s ON b.Slot_ID = s.Slot_ID 
             WHERE s.Mentor_ID = mp.Mentor_ID AND b.Rating IS NOT NULL) AS Review_Count
        FROM Users u
        JOIN Mentor_Profiles mp ON u.User_ID = mp.User_ID
        JOIN Universities un    ON mp.Uni_ID  = un.Uni_ID
        WHERE u.Role = 'mentor'
    `;
    
    const params = [];
    
    // Dynamically add filters if the user selected them!
    if (country) {
        query += ` AND u.Country = ?`;
        params.push(country);
    }
    if (uni_id) {
        query += ` AND mp.Uni_ID = ?`;
        params.push(uni_id);
    }
    
    query += ` ORDER BY Avg_Rating DESC;`;

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});
// ROUTE 2: Get available slots for a mentor

app.get('/api/slots/:mentorId', (req, res) => {
    const mentorId = req.params.mentorId;
    
    // Notice we added 'Is_Booked' to the SELECT statement
    const query = `
        SELECT Slot_ID, Slot_Date, Start_Time, End_Time, Is_Booked 
        FROM Availability_Slots 
        WHERE Mentor_ID = ? 
        ORDER BY Slot_Date, Start_Time;
    `;

    db.query(query, [mentorId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});
// ROUTE 3: Book a slot (Using Stored Procedure)
app.post('/api/book', (req, res) => {
    const { mentee_id, slot_id } = req.body;
    
    if (!mentee_id || !slot_id) {
        return res.status(400).json({ error: 'mentee_id and slot_id are required.' });
    }

    // 1. Execute the stored procedure
    const callProcedure = `CALL book_session(?, ?, @result);`;
    
    db.query(callProcedure, [mentee_id, slot_id], (err) => {
        if (err) {
            console.error("Procedure Error:", err);
            return res.status(500).json({ error: 'Database transaction failed.' });
        }
        
        // 2. Fetch the OUT parameter (@result) from the current connection session
        db.query(`SELECT @result AS message;`, (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to retrieve booking status.' });
            }
            
            const message = results[0].message;
            
            // 3. Check the text returned by your procedure to determine HTTP status
            if (message === 'Booking confirmed successfully!') {
                return res.json({ success: true, message: message });
            } else {
                // This gracefully handles: 
                // "Free plan limit reached. Upgrade to Pro."
                // "Sorry, this slot is already taken."
                // "Only mentees can book sessions."
                return res.status(403).json({ success: false, error: message });
            }
        });
    });
});

// ROUTE 4: Get all bookings (admin)

app.get('/api/bookings', (req, res) => {
    const query = `
        SELECT 
            b.Booking_ID, b.Status, b.Booking_Timestamp, b.Meeting_Link,
            CONCAT(mentee.Fname, ' ', mentee.Lname) AS Mentee_Name,
            CONCAT(mentor_u.Fname, ' ', mentor_u.Lname) AS Mentor_Name,
            un.Uni_Name, s.Slot_Date, s.Start_Time, s.End_Time
        FROM Bookings b
        JOIN Users mentee         ON b.Mentee_ID  = mentee.User_ID
        JOIN Availability_Slots s ON b.Slot_ID    = s.Slot_ID
        JOIN Mentor_Profiles mp   ON s.Mentor_ID  = mp.Mentor_ID
        JOIN Users mentor_u       ON mp.User_ID   = mentor_u.User_ID
        JOIN Universities un      ON mp.Uni_ID    = un.Uni_ID
        ORDER BY b.Booking_Timestamp DESC;
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ROUTE 5: Register

app.post('/api/register', (req, res) => {
    const { fname, lname, email, role, country } = req.body;
    if (!fname || !lname || !email || !role || !country)
        return res.status(400).json({ error: 'All fields are required.' });

    const query = `INSERT INTO Users (Fname, Lname, Email, Role, Country) VALUES (?, ?, ?, ?, ?)`;
    db.query(query, [fname, lname, email, role, country], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY')
                return res.status(409).json({ error: 'Email already registered.' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, user_id: result.insertId, role });
    });
});

// ROUTE 6: Login

app.post('/api/login', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const query = `SELECT User_ID, Fname, Lname, Role, Country FROM Users WHERE Email = ?`;
    db.query(query, [email], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0)
            return res.status(404).json({ error: 'No account found with this email.' });
        res.json({ success: true, user: results[0] });
    });
});

// ROUTE 7: Get mentor profile by user_id
app.get('/api/mentor-profile/:userId', (req, res) => {
    const query = `
        SELECT mp.*, un.Uni_Name, un.City
        FROM Mentor_Profiles mp
        JOIN Universities un ON mp.Uni_ID = un.Uni_ID
        WHERE mp.User_ID = ?
    `;
    db.query(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0] || null);
    });
});

// ROUTE 8: Create or Update mentor profile (REMOVED HOURLY RATE)

app.post('/api/mentor-profile', (req, res) => {
    const { user_id, uni_id, degree_name, grad_year, bio, meeting_link } = req.body;
    
    const query = `
        INSERT INTO Mentor_Profiles (User_ID, Uni_ID, Degree_Name, Grad_Year, Bio, Meeting_Link)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            Uni_ID = VALUES(Uni_ID), Degree_Name = VALUES(Degree_Name), 
            Grad_Year = VALUES(Grad_Year), Bio = VALUES(Bio), 
            Meeting_Link = VALUES(Meeting_Link)
    `;
    
    db.query(query, [user_id, uni_id, degree_name, grad_year, bio, meeting_link], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mentor_id: result.insertId || req.body.mentor_id });
    });
});

// ROUTE 9: Add availability slot

app.post('/api/slots', (req, res) => {
    const { mentor_id, slot_date, start_time, end_time } = req.body;
    const query = `
        INSERT INTO Availability_Slots (Mentor_ID, Slot_Date, Start_Time, End_Time, Is_Booked)
        VALUES (?, ?, ?, ?, 0)
    `;
    db.query(query, [mentor_id, slot_date, start_time, end_time], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, slot_id: result.insertId });
    });
});

// ROUTE 10: Get all universities

app.get('/api/universities', (req, res) => {
    db.query('SELECT * FROM Universities ORDER BY Uni_Name', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});


// ROUTE 11: Get bookings for a mentee

app.get('/api/my-bookings/:userId', (req, res) => {
    const query = `
        SELECT 
            b.Booking_ID, b.Status, b.Rating, mp.Meeting_Link,
            CONCAT(u.Fname, ' ', u.Lname) AS Mentor_Name,
            un.Uni_Name, s.Slot_Date, s.Start_Time, s.End_Time
        FROM Bookings b
        JOIN Availability_Slots s ON b.Slot_ID    = s.Slot_ID
        JOIN Mentor_Profiles mp   ON s.Mentor_ID  = mp.Mentor_ID
        JOIN Users u              ON mp.User_ID   = u.User_ID
        JOIN Universities un      ON mp.Uni_ID    = un.Uni_ID
        WHERE b.Mentee_ID = ?
        ORDER BY s.Slot_Date DESC;
    `;
    db.query(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ROUTE 12: Get bookings for a mentor

app.get('/api/mentor-bookings/:mentorId', (req, res) => {
    const query = `
        SELECT 
            b.Booking_ID, b.Status, mp.Meeting_Link, 
            b.Rating, b.Review_Comment, /* <--- Ratings Added! */
            CONCAT(u.Fname, ' ', u.Lname) AS Mentee_Name,
            u.Country, s.Slot_Date, s.Start_Time, s.End_Time
        FROM Bookings b
        JOIN Users u              ON b.Mentee_ID  = u.User_ID
        JOIN Availability_Slots s ON b.Slot_ID    = s.Slot_ID
        JOIN Mentor_Profiles mp   ON s.Mentor_ID  = mp.Mentor_ID
        WHERE mp.Mentor_ID = ?
        ORDER BY s.Slot_Date DESC;
    `;
    db.query(query, [req.params.mentorId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});


// ROUTE 13: Update booking status

app.put('/api/booking-status', (req, res) => {
    const { booking_id, status } = req.body;
    const query = `
        UPDATE Bookings 
        SET Status = ? 
        WHERE Booking_ID = ?
    `;
    db.query(query, [status, booking_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
    
});

// ROUTE 14: Upgrade Subscription to Pro

app.post('/api/subscriptions/upgrade', (req, res) => {
    const { mentee_id } = req.body;

    if (!mentee_id) {
        return res.status(400).json({ error: 'mentee_id is required.' });
    }

    // Using ON DUPLICATE KEY UPDATE because Mentee_ID is UNIQUE in your schema
    const query = `
        INSERT INTO Subscriptions (Mentee_ID, Plan, Start_Date, Is_Active) 
        VALUES (?, 'pro', CURDATE(), 1)
        ON DUPLICATE KEY UPDATE 
        Plan = 'pro', Is_Active = 1, Start_Date = CURDATE(), End_Date = NULL;
    `;

    db.query(query, [mentee_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Successfully upgraded to Pro!' });
    });
});

// ROUTE 15: Check User's Current Subscription

app.get('/api/subscriptions/:userId', (req, res) => {
    const query = `SELECT Plan, Is_Active FROM Subscriptions WHERE Mentee_ID = ?`;
    
    db.query(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // If they have a subscription in the database, return it.
        // If the array is empty (no subscription yet), default them to 'free'
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.json({ Plan: 'free', Is_Active: 1 }); 
        }
    });
});

// ROUTE 16: Complete Session & Award Points

app.post('/api/complete-session', (req, res) => {
    const { booking_id } = req.body;

    if (!booking_id) return res.status(400).json({ error: 'booking_id is required.' });

    // 1. First, call the procedure
    db.query('CALL confirm_and_award_points(?, @result)', [booking_id], (err) => {
        if (err) {
            console.error("Procedure Error:", err);
            return res.status(500).json({ error: 'Database transaction failed.' });
        }
        
        // 2. Once the procedure finishes, fetch the output message
        db.query('SELECT @result AS message', (err, results) => {
            if (err) {
                console.error("Result Fetch Error:", err);
                return res.status(500).json({ error: 'Failed to verify points.' });
            }
            
            const message = results[0].message;
            
            if (message && message.includes('Points and Streak updated')) {
                return res.json({ success: true, message: message });
            } else {
                return res.status(400).json({ success: false, error: message });
            }
        });
    });
});


// ROUTE 17: Get Mentor Points Balance

app.get('/api/points/:mentorId', (req, res) => {
    const query = `
        SELECT Total_Points, Current_Streak, Last_Session_Date 
        FROM Mentor_Points 
        WHERE Mentor_ID = ?
    `;
    db.query(query, [req.params.mentorId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.json({ Total_Points: 0, Current_Streak: 0, Last_Session_Date: null });
        }
    });
});

// ROUTE 18: Admin - Global Platform Stats

app.get('/api/admin/stats', (req, res) => {
    const query = `
        SELECT 
            (SELECT COUNT(*) FROM Users) AS totalUsers,
            (SELECT COUNT(*) FROM Users WHERE Role = 'mentor') AS totalMentors,
            (SELECT COUNT(*) FROM Subscriptions WHERE Plan = 'pro' AND Is_Active = 1) AS activePro,
            (SELECT COUNT(*) FROM Bookings WHERE Status = 'confirmed') AS confirmedBookings
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results[0]);
    });
});


// ROUTE 19: Admin - All System Bookings

app.get('/api/admin/bookings', (req, res) => {
    const query = `
        SELECT 
            b.Booking_ID, 
            u_mentee.Fname AS Mentee_Name, 
            u_mentor.Fname AS Mentor_Name,
            uni.Uni_Name,
            s.Slot_Date, 
            s.Start_Time, 
            s.End_Time, 
            b.Status
        FROM Bookings b
        JOIN Availability_Slots s ON b.Slot_ID = s.Slot_ID
        JOIN Mentor_Profiles mp ON s.Mentor_ID = mp.Mentor_ID
        JOIN Universities uni ON mp.Uni_ID = uni.Uni_ID
        JOIN Users u_mentor ON mp.User_ID = u_mentor.User_ID
        JOIN Users u_mentee ON b.Mentee_ID = u_mentee.User_ID
        ORDER BY s.Slot_Date DESC, s.Start_Time DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ROUTE 20: Submit a Session Review

app.post('/api/review', (req, res) => {
    const { booking_id, rating, comment } = req.body;
    
    // Safety check
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be a number between 1 and 5.' });
    }

    const query = `UPDATE Bookings SET Rating = ?, Review_Comment = ? WHERE Booking_ID = ?`;
    
    db.query(query, [rating, comment, booking_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Review saved!' });
    });
});
app.listen(PORT, () => {
    console.log(`🚀 CampusBridge running at http://localhost:${PORT}`);
});
