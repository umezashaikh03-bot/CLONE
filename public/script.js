// 1. GLOBAL VARIABLES
var socket;
var currentDocId = null;
var openTabs = [];      
var serverDocs = [];    
let userRole = 'Editor';
const MAX_TABS = 2;     
let saveTimeout = null; // For the auto-save indicator

// ==========================================
// NEW FEATURES: DARK MODE & SAVE STATUS
// ==========================================

function toggleDarkMode() {
    const body = document.body;
    const icon = document.getElementById('theme-icon');
    
    body.classList.toggle('dark-theme');
    
    if (body.classList.contains('dark-theme')) {
        icon.classList.replace('fa-moon', 'fa-sun');
        localStorage.setItem('theme', 'dark');
    } else {
        icon.classList.replace('fa-sun', 'fa-moon');
        localStorage.setItem('theme', 'light');
    }
}

function updateSaveStatus() {
    const statusEl = document.getElementById('save-status');
    statusEl.innerText = "Saving...";
    statusEl.style.opacity = "1";

    // Clear existing timer
    clearTimeout(saveTimeout);

    // Set timer to change text back to "Saved" after 1 second of no typing
    saveTimeout = setTimeout(() => {
        statusEl.innerText = "All changes saved to Drive";
        statusEl.style.opacity = "0.7";
    }, 1000);
}

// ==========================================
// TOOLBAR & FORMATTING
// ==========================================

function focusEditor() {
    document.getElementById('editor').focus();
}

function format(command, value = null) {
    focusEditor();
    document.execCommand(command, false, value);
    sendChanges(); 
}

function insertImage() {
    const url = prompt("Paste image URL:");
    if (url) format('insertImage', url);
}

function insertLink() {
    const url = prompt("Paste link URL:");
    if (url) format('createLink', url);
}

function insertTable() {
    const rows = prompt("Rows:", "2"), cols = prompt("Cols:", "2");
    if (rows && cols) {
        focusEditor();
        let table = `<table border="1" style="width:100%; border-collapse: collapse; margin: 10px 0;">`;
        for (let i = 0; i < rows; i++) table += `<tr>${'<td>Cell</td>'.repeat(cols)}</tr>`;
        table += `</table><br>`;
        document.execCommand('insertHTML', false, table);
        sendChanges();
    }
}

// VIEW / TOOLS
function changeZoom(val) {
    document.getElementById('zoom-percent').innerText = val + "%";
    document.getElementById('editor').style.zoom = val / 100;
}

function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
}

function showWordCount() {
    alert(document.getElementById('word-count-bar').innerText);
}

function simulateFind() {
    const query = prompt("Find text:");
    if (query) { focusEditor(); window.find(query); }
}

// ==========================================
// DOCUMENT & TAB LOGIC
// ==========================================

async function fetchMyDocs() {
    try {
        const res = await fetch('/api/my-docs', { headers: getAuthHeaders() });
        serverDocs = await res.json(); 
    } catch (e) { console.error(e); }
}

function createNewDoc() {
    const newId = "doc_" + Date.now();
    const newDoc = { id: newId, title: "Untitled Document" };
    if (openTabs.length >= MAX_TABS) openTabs.shift(); 
    if (!openTabs.find(doc => doc.id === newId)) openTabs.push(newDoc);
    switchTab(newId);
}

function switchTab(id) {
    currentDocId = id;
    window.history.pushState({}, '', `?doc=${id}`);
    const docData = serverDocs.find(d => d._id === id) || { _id: id, title: "Untitled Document" };
    
    if (!openTabs.find(doc => doc.id === id)) {
        if (openTabs.length >= MAX_TABS) openTabs.shift(); 
        openTabs.push({ id: id, title: docData.title });
    }

    const s = ensureSocket();
    if (s) s.emit('get-document', { docId: id, username: localStorage.getItem("loggedInUser"), token: localStorage.getItem("token") });
    renderDocList();
}

function closeTab(id, event) {
    event.stopPropagation(); 
    openTabs = openTabs.filter(doc => doc.id !== id);
    if (currentDocId === id) {
        if (openTabs.length > 0) switchTab(openTabs[0].id);
        else {
            currentDocId = null;
            document.getElementById('editor').innerHTML = "";
            document.getElementById('doc-title').value = "Untitled document";
        }
    }
    renderDocList();
}

function renderDocList() {
    const bar = document.getElementById('tabs-bar');
    bar.innerHTML = "";
    openTabs.forEach(doc => {
        const tab = document.createElement('div');
        tab.className = `tab ${doc.id === currentDocId ? 'active' : ''}`;
        tab.innerHTML = `<span>${doc.title}</span><i class="fa-solid fa-xmark delete-doc-btn" onclick="closeTab('${doc.id}', event)"></i>`;
        tab.onclick = () => switchTab(doc.id);
        bar.appendChild(tab);
    });
}

// ==========================================
// SOCKETS & SYNC
// ==========================================

function ensureSocket() {
    if (typeof io === 'undefined') return null;
    if (!socket) {
        socket = io();
        socket.on('load-document', (doc) => {
            document.getElementById('editor').innerHTML = doc.content || "";
            document.getElementById('doc-title').value = doc.title || "Untitled document";
            userRole = doc.role || 'Editor'; 
            applyRolePermissions(userRole);
            updateStats();
        });
        socket.on('receive-changes', ({ content, title }) => {
            const editor = document.getElementById('editor');
            if (title !== document.getElementById('doc-title').value) document.getElementById('doc-title').value = title;
            if (content !== editor.innerHTML) {
                const pos = saveCaretPosition(editor);
                editor.innerHTML = content;
                restoreCaretPosition(editor, pos);
            }
            updateStats();
        });
    }
    return socket;
}

function sendChanges() {
    if (!currentDocId || !socket) return;
    updateSaveStatus(); // <--- TRIGGER AUTO-SAVE INDICATOR
    socket.emit('send-changes', { 
        docId: currentDocId, 
        content: document.getElementById('editor').innerHTML, 
        title: document.getElementById('doc-title').value, 
        token: localStorage.getItem("token") 
    });
}

function applyRolePermissions(role) {
    document.getElementById('editor').contentEditable = (role === 'Viewer') ? "false" : "true";
}

function updateStats() {
    const text = document.getElementById('editor').innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    document.getElementById('word-count-bar').innerText = `Words: ${words} | Characters: ${text.length}`;
}

function saveCaretPosition(el) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const pre = range.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.endContainer, range.endOffset);
        return pre.toString().length;
    }
    return 0;
}

function restoreCaretPosition(el, pos) {
    const sel = window.getSelection();
    const range = document.createRange();
    let count = 0, stack = [el], node, found = false;
    while (!found && (node = stack.pop())) {
        if (node.nodeType === 3) {
            const next = count + node.length;
            if (pos <= next) {
                range.setStart(node, pos - count);
                range.collapse(true);
                found = true;
            }
            count = next;
        } else {
            let i = node.childNodes.length;
            while (i--) stack.push(node.childNodes[i]);
        }
    }
    sel.removeAllRanges();
    sel.addRange(range);
}

function getAuthHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("token")}` };
}

// ==========================================
// SHARE MODAL
// ==========================================

function openShareModal() { document.getElementById('share-modal').style.display = 'flex'; }
function closeShareModal() { document.getElementById('share-modal').style.display = 'none'; }

async function confirmShare() {
    const shareWithUser = document.getElementById('share-username').value;
    const email = document.getElementById('share-email').value; 
    const role = document.getElementById('share-role').value;
    const res = await fetch('/api/share', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ docId: currentDocId, shareWithUser, email, role })
    });
    const data = await res.json();
    alert(data.success ? "🎉 Shared successfully!" : "❌ Error: " + data.message);
}

function copyShareLink() {
    navigator.clipboard.writeText(window.location.href);
    alert("Link copied to clipboard!");
}

// ==========================================
// STARTUP
// ==========================================

window.addEventListener('load', async () => {
    ensureSocket();
    const user = localStorage.getItem("loggedInUser");
    if (!user) { window.location.href = "login.html"; return; }
    document.getElementById('user-display').innerText = user.substring(0, 2).toUpperCase();
    
    // LOAD THEME PREFERENCE
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('theme-icon').classList.replace('fa-moon', 'fa-sun');
    }
    
    await fetchMyDocs(); 
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('doc');
    
    if (docId) switchTab(docId);
    else if (serverDocs.length > 0) switchTab(serverDocs[0]._id);
    else createNewDoc();

    document.getElementById('editor').addEventListener('input', () => { sendChanges(); updateStats(); });
    document.getElementById('doc-title').addEventListener('input', () => { sendChanges(); });
});