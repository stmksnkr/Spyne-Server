const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');

const { sequelize } = require('./models/user');
const authRouter = require('./router/auth');
const app = express();
const port = 3000;


// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'discussion_app',
    password: 'root',
    port: 5432
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Connected to the PostgreSQL database.');
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// File upload setup
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// Routes
app.use('/auth', authRouter);
// User Routes
app.post('/users', (req, res) => {
    const { name, mobile_no, email } = req.body;
    const sql = 'INSERT INTO Users (name, mobile_no, email) VALUES ($1, $2, $3) RETURNING *';
    pool.query(sql, [name, mobile_no, email], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(201).json(result.rows[0]);
    });
});

app.put('/users/:id', (req, res) => {
    const { id } = req.params;
    const { name, mobile_no, email } = req.body;
    const sql = 'UPDATE Users SET name = $1, mobile_no = $2, email = $3 WHERE id = $4 RETURNING *';
    pool.query(sql, [name, mobile_no, email, id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).json(result.rows[0]);
    });
});

app.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM Users WHERE id = $1 RETURNING *';
    pool.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).json(result.rows[0]);
    });
});

app.get('/users', (req, res) => {
    const sql = 'SELECT * FROM Users';
    pool.query(sql, (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).json(result.rows);
    });
});

app.get('/users/search', (req, res) => {
    const { name } = req.query;
    const sql = 'SELECT * FROM Users WHERE name ILIKE $1';
    pool.query(sql, [`%${name}%`], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).json(result.rows);
    });
});

// Discussion Routes
app.post('/discussions', upload.single('image'), (req, res) => {
    const { user_id, text, hashtags } = req.body;
    const image = req.file ? req.file.filename : null;

    const discussionSql = 'INSERT INTO Discussions (user_id, text, image) VALUES ($1, $2, $3) RETURNING *';
    pool.query(discussionSql, [user_id, text, image], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }

        const discussionId = result.rows[0].id;
        const hashtagList = hashtags.split(',').map(tag => tag.trim());

        const hashtagPromises = hashtagList.map(tag => {
            return pool.query('INSERT INTO Hashtags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [tag])
                .then(result => result.rows[0].id)
                .catch(err => {
                    console.error('Error inserting hashtag:', err);
                    throw err;
                });
        });

        Promise.all(hashtagPromises)
            .then(hashtagIds => {
                const discussionHashtagSql = 'INSERT INTO DiscussionHashtags (discussion_id, hashtag_id) VALUES ($1, $2)';
                const values = hashtagIds.map(id => [discussionId, id]);

                return Promise.all(values.map(value => pool.query(discussionHashtagSql, value)));
            })
            .then(() => {
                res.status(201).send('Discussion posted');
            })
            .catch(err => res.status(500).send(err));
    });
});

app.put('/discussions/:id', (req, res) => {
    const { id } = req.params;
    const { text, hashtags } = req.body;

    const discussionSql = 'UPDATE Discussions SET text = $1 WHERE id = $2 RETURNING *';
    pool.query(discussionSql, [text, id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }

        const discussionId = result.rows[0].id;
        const hashtagList = hashtags.split(',').map(tag => tag.trim());

        const deleteSql = 'DELETE FROM DiscussionHashtags WHERE discussion_id = $1';
        pool.query(deleteSql, [discussionId], (err) => {
            if (err) {
                return res.status(500).send(err);
            }

            const hashtagPromises = hashtagList.map(tag => {
                return pool.query('INSERT INTO Hashtags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [tag])
                    .then(result => result.rows[0].id)
                    .catch(err => {
                        console.error('Error inserting hashtag:', err);
                        throw err;
                    });
            });

            Promise.all(hashtagPromises)
                .then(hashtagIds => {
                    const discussionHashtagSql = 'INSERT INTO DiscussionHashtags (discussion_id, hashtag_id) VALUES ($1, $2)';
                    const values = hashtagIds.map(id => [discussionId, id]);

                    return Promise.all(values.map(value => pool.query(discussionHashtagSql, value)));
                })
                .then(() => {
                    res.status(200).send('Discussion updated');
                })
                .catch(err => res.status(500).send(err));
        });
    });
});

app.delete('/discussions/:id', (req, res) => {
    const { id } = req.params;
    const deleteDiscussionHashtagsSql = 'DELETE FROM DiscussionHashtags WHERE discussion_id = $1';
    pool.query(deleteDiscussionHashtagsSql, [id], (err) => {
        if (err) {
            return res.status(500).send(err);
        }

        const deleteDiscussionSql = 'DELETE FROM Discussions WHERE id = $1 RETURNING *';
        pool.query(deleteDiscussionSql, [id], (err, result) => {
            if (err) {
                return res.status(500).send(err);
            }
            res.status(200).json(result.rows[0]);
        });
    });
});

app.get('/discussions', (req, res) => {
    const sql = 'SELECT * FROM discussions';
    pool.query(sql, (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).json(result.rows);
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
