require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ MongoDB Error: ", err));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true }, 
    password: { type: String, required: true }
}));

const Document = mongoose.model('Document', new mongoose.Schema({
    _id: String, title: String, content: String, owner: String,           
    sharedWith: [{ username: String, role: String }], isPublic: { type: Boolean, default: false }
}));

const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) { res.status(401).json({ success: false, message: "Invalid Session" }); }
};

// --- THE WORKING GMAIL CONFIG ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS // MUST be the 16-char App Password
    },
    tls: { rejectUnauthorized: false }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, email, password: hashedPassword });
        res.json({ success: true });
    } catch (e) { res.status(400).json({ success: false, message: "User already exists" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ success: true, username: user.username, token });
        } else { res.status(401).json({ success: false, message: "Invalid credentials" }); }
    } catch (e) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/share', authenticate, async (req, res) => {
    console.log("--- SHARE REQUEST RECEIVED ---"); 
    const { docId, shareWithUser, role, email } = req.body;
    console.log(`RECEIVED DATA -> DocId: ${docId}, User: ${shareWithUser}, Email: ${email}`);

    try {
        const doc = await Document.findById(docId);
        if (!doc) return res.status(404).json({ success: false, message: "Doc not found" });

        if (shareWithUser) {
            const userIndex = doc.sharedWith.findIndex(u => u.username === shareWithUser);
            if (userIndex > -1) doc.sharedWith[userIndex].role = role;
            else doc.sharedWith.push({ username: shareWithUser, role: role });
        } 

        if (email) doc.isPublic = true; 
        await doc.save();
        console.log("✅ Document saved to MongoDB");

        if (email && email.trim() !== "") {
            console.log(`📧 Attempting to send email to: ${email}...`);
            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
            
            try {
                await transporter.sendMail({
                    from: `"Pro Docs" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: `🚀 Invite: ${doc.title}`,
                    html: `<p>You've been invited to <b>${doc.title}</b>.</p><a href="${baseUrl}/editor.html?doc=${docId}">Open Doc</a>`
                });
                console.log("✅ EMAIL SENT SUCCESSFULLY!");
            } catch (mailErr) {
                console.error("❌ GMAIL ERROR: ", mailErr); 
            }
        } else {
            console.log("⚠️ No email provided, skipping Gmail.");
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("❌ SERVER ERROR:", e);
        res.status(500).json({ success: false, message: e.message }); 
    }
});

app.get('/api/my-docs', authenticate, async (req, res) => {
    try {
        const docs = await Document.find({ $or: [{ owner: req.user.username }, { "sharedWith.username": req.user.username }] });
        res.json(docs);
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/collaborators/:id', authenticate, async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        res.json({ success: true, collaborators: [{ username: doc.owner, role: 'Owner' }, ...doc.sharedWith] });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/api/document/:id', authenticate, async (req, res) => {
    try { await Document.findByIdAndDelete(req.params.id); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ success: false }); }
});

io.on('connection', (socket) => {
    socket.on('get-document', async ({ docId, username, token }) => {
        try {
            let decoded = null;
            if (token) { try { decoded = jwt.verify(token, JWT_SECRET); } catch(e) {} }
            let doc = await Document.findById(docId);
            if (!doc) {
                if (!decoded) return socket.emit('error-msg', 'Login required');
                doc = await Document.create({ _id: docId, title: "Untitled Document", content: "", owner: decoded.username, sharedWith: [] });
            }
            socket.join(docId);
            socket.emit('load-document', { ...doc._doc, role: decoded ? (doc.owner === decoded.username ? 'Owner' : 'Editor') : 'Viewer' });
        } catch (err) { socket.emit('error-msg', 'Session error'); }
    });

    socket.on('send-changes', async ({ docId, content, title, username, token }) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            await Document.findByIdAndUpdate(docId, { content, title });
            socket.to(docId).emit('receive-changes', { content, title });
        } catch (err) { }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));