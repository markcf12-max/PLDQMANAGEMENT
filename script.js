/* ==========================================================================
   FIREBASE
   ========================================================================== */
import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    deleteUser,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    doc, getDoc, setDoc, deleteDoc,
    collection, query, where, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const TEAM_LEADER_INVITE_CODE = 'SMART-TL-2026';[cite: 1]
const QUALITY_INVITE_CODE = 'SMART-QA-2026';[cite: 1]

/* Firestore write batches max out at 500 ops — chunk anything bigger */
async function batchWriteDocs(collectionName, docs, idFn) {
    const chunks = [];
    for (let i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));[cite: 1]
    for (const chunk of chunks) {
        const batch = writeBatch(db);[cite: 1]
        chunk.forEach(d => {
            const ref = idFn ? doc(db, collectionName, idFn(d)) : doc(collection(db, collectionName));[cite: 1]
            batch.set(ref, d);[cite: 1]
        });
        await batch.commit();[cite: 1]
    }
}

async function clearCollection(collectionName) {
    const snap = await getDocs(collection(db, collectionName));[cite: 1]
    const ids = snap.docs.map(d => d.id);[cite: 1]
    for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);[cite: 1]
        const batch = writeBatch(db);[cite: 1]
        chunk.forEach(id => batch.delete(doc(db, collectionName, id)));[cite: 1]
        await batch.commit();[cite: 1]
    }
}

async function replaceAuditData(rows) {
    const metaRef = doc(db, 'meta', 'auditData');[cite: 1]
    const metaSnap = await getDoc(metaRef);[cite: 1]
    const prevCount = metaSnap.exists() ? (metaSnap.data().count || 0) : 0;[cite: 1]

    for (let i = 0; i < prevCount; i += 400) {
        const end = Math.min(i + 400, prevCount);[cite: 1]
        const batch = writeBatch(db);[cite: 1]
        for (let j = i; j < end; j++) batch.delete(doc(db, 'auditData', 'row_' + j));[cite: 1]
        await batch.commit();[cite: 1]
    }

    for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);[cite: 1]
        const batch = writeBatch(db);[cite: 1]
        chunk.forEach((row, idx) => batch.set(doc(db, 'auditData', 'row_' + (i + idx)), row));[cite: 1]
        await batch.commit();[cite: 1]
    }

    await setDoc(metaRef, { count: rows.length, updatedAt: Date.now() });[cite: 1]
}

/* ==========================================================================
   SESSION
   ========================================================================== */
let currentSession = null;[cite: 1]

/* ==========================================================================
   AUTH UI
   ========================================================================== */
function switchAuthTab(which) {
    document.getElementById('tabLogin')?.classList.toggle('active', which === 'login');[cite: 1]
    document.getElementById('tabSignup')?.classList.toggle('active', which === 'signup');[cite: 1]
    
    const loginPane = document.getElementById('loginPane');[cite: 1]
    if (loginPane) loginPane.style.display = which === 'login' ? 'block' : 'none';[cite: 1]
    
    const signupPane = document.getElementById('signupPane');[cite: 1]
    if (signupPane) signupPane.style.display = which === 'login' ? 'none' : 'block';[cite: 1]
}

let signupRole = 'agent';[cite: 1]
function setSignupRole(role) {
    signupRole = role;[cite: 1]
    document.getElementById('roleAgentLabel')?.classList.toggle('checked', role === 'agent');[cite: 1]
    document.getElementById('roleTeamLeaderLabel')?.classList.toggle('checked', role === 'team_leader');[cite: 1]
    document.getElementById('roleQualityLabel')?.classList.toggle('checked', role === 'quality');[cite: 1]
    
    const needsCode = role === 'team_leader' || role === 'quality';[cite: 1]
    const codeGroup = document.getElementById('supervisorCodeGroup');[cite: 1]
    if (codeGroup) codeGroup.style.display = needsCode ? 'block' : 'none';[cite: 1]
    
    const codeLabel = document.getElementById('supervisorCodeLabel');[cite: 1]
    if (codeLabel && needsCode) {
        codeLabel.textContent = role === 'team_leader' ? 'Team Leader Invite Code' : 'Quality Invite Code';[cite: 1]
    }
}

function showAuthMsg(elId, text, ok) {
    const el = document.getElementById(elId);[cite: 1]
    if (!el) return;[cite: 1]
    el.textContent = text;[cite: 1]
    el.className = 'auth-msg ' + (ok ? 'ok' : 'error');[cite: 1]
    el.style.display = 'block'; 
}

let authFlowInProgress = false;[cite: 1]
// Updated constraint to match your Conduent / PLDT application rules
const REQUIRED_EMAIL_DOMAIN = '@pldt.com';[cite: 1, 3]

async function handleSignup() {
    const emailEl = document.getElementById('signupEmail');[cite: 1]
    const pwEl = document.getElementById('signupPassword');[cite: 1]
    const pw2El = document.getElementById('signupPassword2');[cite: 1]
    
    const email = emailEl ? emailEl.value.trim().toLowerCase() : '';[cite: 1]
    const pw = pwEl ? pwEl.value : '';[cite: 1]
    const pw2 = pw2El ? pw2El.value : '';[cite: 1]

    if (!email || !email.includes('@')) return showAuthMsg('authMessage', 'Enter a valid work email.', false);[cite: 1]
    if (!email.endsWith(REQUIRED_EMAIL_DOMAIN)) return showAuthMsg('authMessage', `Please sign up using your ${REQUIRED_EMAIL_DOMAIN} work email.`, false);[cite: 1]
    if (pw.length < 6) return showAuthMsg('authMessage', 'Password must be at least 6 characters.', false);[cite: 1]
    if (pw !== pw2) return showAuthMsg('authMessage', 'Passwords do not match.', false);[cite: 1]

    authFlowInProgress = true;[cite: 1]
    try {
        if (signupRole === 'team_leader' || signupRole === 'quality') {
            const requiredCode = signupRole === 'team_leader' ? TEAM_LEADER_INVITE_CODE : QUALITY_INVITE_CODE;[cite: 1]
            const codeEl = document.getElementById('supervisorCode');[cite: 1]
            const code = codeEl ? codeEl.value.trim() : '';[cite: 1]
            if (code !== requiredCode) return showAuthMsg('authMessage', 'Invalid invite code.', false);[cite: 1]

            let cred;[cite: 1]
            try {
                cred = await createUserWithEmailAndPassword(auth, email, pw);[cite: 1]
            } catch (err) {
                return showAuthMsg('authMessage', friendlyAuthError(err), false);[cite: 1]
            }
            await setDoc(doc(db, 'users', cred.user.uid), { email, role: signupRole });[cite: 1]
            await signOut(auth);[cite: 1]
            showAuthMsg('authMessage', `${signupRole === 'team_leader' ? 'Team Leader' : 'Quality'} account created. You can log in now.`, true);[cite: 1]
            clearSignupForm();[cite: 1]
            setTimeout(() => switchAuthTab('login'), 1200);[cite: 1]
            return;
        }

        let cred;[cite: 1]
        try {
            cred = await createUserWithEmailAndPassword(auth, email, pw);[cite: 1]
        } catch (err) {
            return showAuthMsg('authMessage', friendlyAuthError(err), false);[cite: 1]
            return showAuthMsg('authMessage', friendlyAuthError(err), false);[cite: 1]
        }

        try {
            const rosterSnap = await getDoc(doc(db, 'roster', email));[cite: 1]
            if (!rosterSnap.exists()) {
                await deleteUser(cred.user);[cite: 1]
                return showAuthMsg('authMessage', 'This email was not found on the agent roster. Ask your supervisor to add you, then try again.', false);[cite: 1]
            }
            const match = rosterSnap.data();[cite: 1]

            await setDoc(doc(db, 'users', cred.user.uid), {
                email,
                role: 'agent',
                agentName: match.agentName,
                agentId: match.agentId || ''[cite: 1]
            });
            await signOut(auth);[cite: 1]
            showAuthMsg('authMessage', `Account created and matched to "${match.agentName}". You can log in now.`, true);[cite: 1]
            clearSignupForm();[cite: 1]
            setTimeout(() => switchAuthTab('login'), 1200);[cite: 1]
        } catch (err) {
            try { await deleteUser(cred.user); } catch (e2) {}[cite: 1]
            showAuthMsg('authMessage', friendlyAuthError(err), false);[cite: 1]
        }
    } finally {
        authFlowInProgress = false;[cite: 1]
    }
}

function clearSignupForm() {
    const email = document.getElementById('signupEmail');[cite: 1]
    const pw = document.getElementById('signupPassword');[cite: 1]
    const pw2 = document.getElementById('signupPassword2');[cite: 1]
    const code = document.getElementById('supervisorCode');[cite: 1]
    
    if (email) email.value = '';[cite: 1]
    if (pw) pw.value = '';[cite: 1]
    if (pw2) pw2.value = '';[cite: 1]
    if (code) code.value = '';[cite: 1]
}

async function handleLogin() {
    const emailEl = document.getElementById('loginEmail');[cite: 1]
    const pwEl = document.getElementById('loginPassword');[cite: 1]
    
    const email = emailEl ? emailEl.value.trim().toLowerCase() : '';[cite: 1]
    const pw = pwEl ? pwEl.value : '';[cite: 1]
    if (!email || !pw) return showAuthMsg('authMessage', 'Enter your email and password.', false);[cite: 1]

    authFlowInProgress = true;[cite: 1]
    try {
        const cred = await signInWithEmailAndPassword(auth, email, pw);[cite: 1]
        const profileSnap = await getDoc(doc(db, 'users', cred.user.uid));[cite: 1]
        if (!profileSnap.exists()) {
            await signOut(auth);[cite: 1]
            return showAuthMsg('authMessage', 'No profile found for this account. Contact your supervisor.', false);[cite: 1]
        }
        
        // Target explicit workspace configurations dynamically from the profile context
        currentSession = { uid: cred.user.uid, ...profileSnap.data() };[cite: 1]
        if (emailEl) emailEl.value = '';[cite: 1]
        if (pwEl) pwEl.value = '';[cite: 1]
        await enterApp();[cite: 1]
    } catch (err) {
        showAuthMsg('authMessage', friendlyAuthError(err), false);[cite: 1]
    } finally {
        authFlowInProgress = false;[cite: 1]
    }
}

function logout() {
    signOut(auth);[cite: 1]
}

function friendlyAuthError(err) {
    const code = err && err.code ? err.code : '';[cite: 1]
    if (code.includes('email-already-in-use')) return 'An account with this email already exists. Try logging in.';[cite: 1]
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Incorrect email or password.';[cite: 1]
    if (code.includes('weak-password')) return 'Password must be at least 6 characters.';[cite: 1]
    if (code.includes('invalid-email')) return 'Enter a valid email address.';[cite: 1]
    return 'Something went wrong: ' + (err && err.message ? err.message : 'please try again.');[cite: 1]
}

function resetToLoggedOutState() {
    currentSession = null;[cite: 1]
    cachedAuditRows = [];[cite: 1]
    
    const appScreen = document.getElementById('appScreen');[cite: 1]
    if (appScreen) appScreen.style.display = 'none';[cite: 1]
    
    const authScreen = document.getElementById('authScreen');[cite: 1]
    if (authScreen) authScreen.style.display = 'flex';[cite: 1]
    
    const sessionChip = document.getElementById('sessionChip');[cite: 1]
    if (sessionChip) sessionChip.style.display = 'none';[cite: 1]
    
    const loginEmail = document.getElementById('loginEmail');[cite: 1]
    if (loginEmail) loginEmail.value = '';[cite: 1]
    
    const loginPassword = document.getElementById('loginPassword');[cite: 1]
    if (loginPassword) loginPassword.value = '';[cite: 1]
    
    const authMessage = document.getElementById('authMessage');[cite: 1, 3]
    if (authMessage) {
        authMessage.textContent = '';[cite: 3]
        authMessage.style.display = 'none';[cite: 3]
    }
    
    clearSignupForm();[cite: 1]
    switchAuthTab('login');[cite: 1]

    const agentAuditList = document.getElementById('agentAuditList');[cite: 1]
    if (agentAuditList) agentAuditList.innerHTML = '';[cite: 1]
    
    const agentScorecard = document.getElementById('agentScorecard');[cite: 1]
    if (agentScorecard) agentScorecard.innerHTML = '';[cite: 1]
    
    const agentWelcomeName = document.getElementById('agentWelcomeName');[cite: 1]
    if (agentWelcomeName) agentWelcomeName.textContent = 'Welcome';[cite: 1]
    
    const rosterStatus = document.getElementById('rosterStatus');[cite: 1]
    if (rosterStatus) rosterStatus.textContent = 'No roster loaded yet.';[cite: 1]
    
    const dataStatus = document.getElementById('dataStatus');[cite: 1]
    if (dataStatus) dataStatus.textContent = 'No audit data loaded yet.';[cite: 1]
    
    const resyncStatus = document.getElementById('resyncStatus');[cite: 1]
    if (resyncStatus) resyncStatus.textContent = 'Use this if agents uploaded/updated after data was already loaded...';[cite: 1]
    
    const uploadPopover = document.getElementById('uploadPopover');[cite: 1]
    if (uploadPopover) uploadPopover.style.display = 'none';[cite: 1]
}

onAuthStateChanged(auth, async (user) => {
    if (authFlowInProgress) return;[cite: 1]
    if (!user) {
        resetToLoggedOutState();[cite: 1]
        return;[cite: 1]
    }
    const profileSnap = await getDoc(doc(db, 'users', user.uid));[cite: 1]
    if (!profileSnap.exists()) {
        await signOut(auth);[cite: 1]
        return;[cite: 1]
    }
    currentSession = { uid: user.uid, ...profileSnap.data() };[cite: 1]
    await enterApp();[cite: 1]
});

async function enterApp() {
    const authScreen = document.getElementById('authScreen');[cite: 1]
    if (authScreen) authScreen.style.display = 'none';[cite: 1]
    
    const appScreen = document.getElementById('appScreen');[cite: 1]
    if (appScreen) appScreen.style.display = 'flex';[cite: 1]
    
    const sessionChip = document.getElementById('sessionChip');[cite: 1]
    if (sessionChip) sessionChip.style.display = 'flex';[cite: 1]

    const roleLabels = { quality: '👤 Quality · ', team_leader: '👤 Team Leader · ', supervisor: '👤 Quality · ', agent: '👤 Agent · ' };[cite: 1]
    const sessionLabel = document.getElementById('sessionLabel');[cite: 1]
    if (sessionLabel) sessionLabel.textContent = (roleLabels[currentSession.role] || '👤 ') + currentSession.email;[cite: 1]

    const canViewDashboard = currentSession.role === 'quality' || currentSession.role === 'team_leader' || currentSession.role === 'supervisor';[cite: 1]
    const canUpload = currentSession.role === 'quality' || currentSession.role === 'supervisor';[cite: 1]

    const supervisorSidebar = document.getElementById('appSidebar');[cite: 1, 3]
    if (supervisorSidebar) supervisorSidebar.style.display = canViewDashboard ? 'flex' : 'none';[cite: 1]
    
    const supervisorView = document.getElementById('supervisorView');[cite: 1]
    if (supervisorView) supervisorView.style.display = canViewDashboard ? 'flex' : 'none';[cite: 1]
    
    const agentView = document.getElementById('agentView');[cite: 1]
    if (agentView) agentView.style.display = canViewDashboard ? 'none' : 'flex';[cite: 1]
    
    const uploadIconBtn = document.getElementById('uploadIconBtn');[cite: 1]
    if (uploadIconBtn) uploadIconBtn.style.display = canUpload ? 'flex' : 'none';[cite: 1]

    if (canViewDashboard) {
        if (canUpload) await refreshRosterStatus();[cite: 1]
        const rows = await loadAllAuditData();[cite: 1]
        if (rows.length) {
            const dataStatus = document.getElementById('dataStatus');[cite: 1]
            if (canUpload && dataStatus) dataStatus.innerHTML = `✅ ${rows.length} audit rows loaded.`;[cite: 1]
            populateDropdownOptions(rows);[cite: 1]
            filterData();[cite: 1]
        }
    } else {
        await renderAgentView();[cite: 1]
    }
}

/* ==========================================================================
   HIT-PARAMETER CONFIG
   ========================================================================== */
const NON_ISSUE_VALUES = new Set(['', 'NO OPPORTUNITY', 'NA', 'N/A', 'NO', 'NONE']);[cite: 1]

const HIT_PARAMS = [
    { col: 'IRRELEVANT SOLUTION', category: 'Reliable', label: 'Irrelevant solution given', type: 'descriptive' },[cite: 1]
    { col: 'INCOMPLETE SOLUTION', category: 'Reliable', label: 'Incomplete solution given', type: 'descriptive' },[cite: 1]
    { col: 'UNTIMELY SOLUTION ( ZTP)', category: 'Reliable', label: 'Untimely solution (ZTP)', type: 'descriptive' },[cite: 1]
    { col: 'UNCLEAR SOLUTION', category: 'Reliable', label: 'Unclear solution given', type: 'descriptive' },[cite: 1]
    { col: 'Poor Listening Skills?', category: 'Personable', label: 'Poor listening skills', type: 'descriptive' },[cite: 1]
    { col: 'Customer Validation and Empathy Gap?', category: 'Personable', label: 'Empathy / validation gap', type: 'descriptive' },[cite: 1]
    { col: 'Did not adjust the tone/pace to match the customer?', category: 'Personable', label: 'Tone/pace not matched to customer', type: 'descriptive' },[cite: 1]
    { col: 'Did not adjust to the customers language?', category: 'Personable', label: 'Language not adjusted to customer', type: 'descriptive' },[cite: 1]
    { col: 'Negative Words, Phrasing and Limitations?', category: 'Personable', label: 'Negative words / phrasing used', type: 'descriptive' },[cite: 1]
    { col: 'Unfriendly/discourteous/sarcastic?', category: 'Personable', label: 'Unfriendly, discourteous, or sarcastic tone', type: 'descriptive' },[cite: 1]
    { col: 'Sounded transactional or robotic?', category: 'Personable', label: 'Sounded transactional or robotic', type: 'descriptive' },[cite: 1]
    { col: 'FAST: Were there other Agent factors observed that affected the customer experience?', category: 'Fast', label: 'Other agent factor slowed the resolution', type: 'descriptive' },[cite: 1]
    { col: 'DID WE FOLLOW THE CUSTOMER AUTHENTICATION PROCESS?', category: 'Safe & Secure', label: 'Customer authentication process missed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE FOLLOW THE DATA PRIVACY POLICY?', category: 'Safe & Secure', label: 'Data privacy policy not followed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE UPDATE THE CUSTOMER INFORMATION IN THE TOOL?', category: 'Safe & Secure', label: 'Customer info not updated in tool', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE FOLLOW THE CSAT/NPS PROCESS?', category: 'Safe & Secure', label: 'CSAT/NPS process not followed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE FOLLOW THE SYSTEM DOCUMENTATION PROCESS?', category: 'Safe & Secure', label: 'System documentation process missed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE FOLLOW THE SYSTEM TAGGING PROCESS?', category: 'Safe & Secure', label: 'System tagging process missed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: 'DID WE FOLLOW CORRECT GRAMMAR, TECHNICAL WRITING & THE PRESCRIBED LANGUAGE?', category: 'Safe & Secure', label: 'Grammar / prescribed language standard missed', type: 'boolean', hitValue: 'NO' },[cite: 1]
    { col: "IS THIS A POTENTIAL CUSTOMER MISTREAT?", category: 'Mistreat', label: 'Potential customer mistreat flagged', type: 'boolean', hitValue: 'YES' }[cite: 1]
];

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));[cite: 1]
}

function normVal(v) {
    return (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();[cite: 1]
}

function normalizeName(str) {
    return String(str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')[cite: 1]
        .toUpperCase()[cite: 1]
        .replace(/[.,'-]/g, ' ')[cite: 1]
        .replace(/\b(JR|SR|II|III|IV)\b/g, '')[cite: 1]
        .replace(/\s+/g, ' ')[cite: 1]
        .trim();[cite: 1]
}

function getRowIssues(row) {
    const issues = [];[cite: 1]
    HIT_PARAMS.forEach(p => {
        const raw = row[p.col];[cite: 1]
        const v = normVal(raw);[cite: 1]
        if (!v) return;[cite: 1]

        if (p.type === 'boolean') {
            if (v === p.hitValue) issues.push({ label: p.label, category: p.category });[cite: 1]
            return;[cite: 1]
        }
        if (!NON_ISSUE_VALUES.has(v)) {
            const detail = v !== 'YES' ? String(raw).trim() : '';[cite: 1]
            issues.push({ label: detail ? `${p.label} — ${detail}` : p.label, category: p.category });[cite: 1]
        }
    });
    return issues;[cite: 1]
}

/* ==========================================================================
   FILE PARSING
   ========================================================================== */
function parseWorkbookFile(file, preferSheetNameContains) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();[cite: 1]
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);[cite: 1]
                const wb = XLSX.read(data, { type: 'array' });[cite: 1]
                let sheetName = wb.SheetNames[0];[cite: 1]
                if (preferSheetNameContains) {
                    const found = wb.SheetNames.find(n => n.toUpperCase().includes(preferSheetNameContains));[cite: 1]
                    if (found) sheetName = found;[cite: 1]
                }
                const ws = wb.Sheets[sheetName];[cite: 1]
                const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });[cite: 1]
                resolve(json);[cite: 1]
            } catch (err) {
                reject(err);[cite: 1]
            }
        };
        reader.onerror = reject;[cite: 1]
        reader.readAsArrayBuffer(file);[cite: 1]
    });
}

function findHeader(row, candidates) {
    const keys = Object.keys(row);[cite: 1]
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());[cite: 1]
        if (hit) return hit;[cite: 1]
    }
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase().includes(cand.toLowerCase()));[cite: 1]
        if (hit) return hit;[cite: 1]
    }
    return null;[cite: 1]
}

/* ==========================================================================
   ROSTER UPLOAD
   ========================================================================== */
async function handleRosterUpload(event) {
    const file = event.target.files[0];[cite: 1]
    if (!file) return;[cite: 1]
    
    const rosterStatus = document.getElementById('rosterStatus');[cite: 1]
    if (rosterStatus) rosterStatus.textContent = 'Processing ' + file.name + '...';[cite: 1]

    try {
        const rows = await parseWorkbookFile(file);[cite: 1]
        if (!rows.length) throw new Error('empty');[cite: 1]

        const emailKey = findHeader(rows[0], ['Email', 'Work Email']);[cite: 1]
        const nameKey = findHeader(rows[0], ['Agent Name', 'AGENT/OFFICER NAME', 'Name']);[cite: 1]
        const idKey = findHeader(rows[0], ['ID', 'Employee ID', 'EE number/ID number', 'Agent ID']);[cite: 1]

        if (!emailKey || !nameKey) throw new Error('missing columns');[cite: 1]

        const roster = rows
            .map(r => ({
                email: String(r[emailKey] || '').trim().toLowerCase(),
                agentName: String(r[nameKey] || '').trim(),
                agentId: idKey ? String(r[idKey] || '').trim() : ''[cite: 1]
            }))
            .filter(r => r.email && r.agentName);[cite: 1]

        await clearCollection('roster');[cite: 1]
        await batchWriteDocs('roster', roster, (r) => r.email);[cite: 1]

        if (rosterStatus) rosterStatus.innerHTML = `✅ Roster loaded: ${roster.length} agents matched.`;[cite: 1]
    } catch (err) {
        console.error(err);[cite: 1]
        if (rosterStatus) rosterStatus.innerHTML = `⚠️ Could not read roster. Expect columns: Email, Agent Name, ID.`;[cite: 1]
    }
}

async function refreshRosterStatus() {
    const snap = await getDocs(collection(db, 'roster'));[cite: 1]
    const rosterStatus = document.getElementById('rosterStatus');[cite: 1]
    if (snap.size && rosterStatus) {
        rosterStatus.innerHTML = `✅ Roster loaded: ${snap.size} agents.`;[cite: 1]
    }
}

async function resyncAgentEmails() {
    const statusEl = document.getElementById('resyncStatus');[cite: 1]
    if (statusEl) statusEl.textContent = 'Re-syncing...';[cite: 1]

    try {
        const rosterSnap = await getDocs(collection(db, 'roster'));[cite: 1]
        const nameToEmail = {};[cite: 1]
        rosterSnap.forEach(d => {
            const data = d.data();[cite: 1]
            nameToEmail[normalizeName(data.agentName)] = d.id;[cite: 1]
        });

        const dataSnap = await getDocs(collection(db, 'auditData'));[cite: 1]
        const docs = dataSnap.docs;[cite: 1]

        let matched = 0, unmatched = 0;[cite: 1]
        const unmatchedNames = new Set();[cite: 1]

        for (let i = 0; i < docs.length; i += 400) {
            const chunk = docs.slice(i, i + 400);[cite: 1]
            const batch = writeBatch(db);[cite: 1]
            chunk.forEach(d => {
                const row = d.data();[cite: 1]
                const key = normalizeName(row['AGENT/OFFICER NAME']);[cite: 1]
                const email = nameToEmail[key] || '';[cite: 1]
                if (email) matched++; else { unmatched++; if (key) unmatchedNames.add(row['AGENT/OFFICER NAME']); }[cite: 1]
                batch.update(doc(db, 'auditData', d.id), { agentEmailLower: email });[cite: 1]
            });
            await batch.commit();[cite: 1]
        }

        let msg = `✅ Re-synced: ${matched} rows matched, ${unmatched} unmatched rows.`;[cite: 1]
        if (statusEl) statusEl.textContent = msg;[cite: 1]
    } catch (err) {
        console.error(err);[cite: 1]
        if (statusEl) statusEl.textContent = '⚠️ Re-sync failed.';[cite: 1]
    }
}

/* ==========================================================================
   RAW DATA UPLOAD
   ========================================================================== */
const NEEDED_FIELDS = [
    'ID', 'FORM TYPE', 'BRAND', 'LINE OF BUSINESS', 'AGENT/OFFICER NAME', 'AGENT TENURE',[cite: 1]
    'TEAM LEADER', 'CLUSTER', 'WEEKENDING', 'MONTH', 'MISTREAT',[cite: 1]
    'RELIABLE', 'PERSONABLE', 'FAST', 'SAFE & SECURE', 'OVERALL SCORE',[cite: 1]
    'EE number/ID number', 'OVERALL PASSRATE', 'CM',[cite: 1]
    'RELIABLE: ADDITIONAL COMMENTS', 'PERSONABLE: ADDITIONAL COMMENTS', 'FAST: ADDITIONAL COMMENTS'[cite: 1]
].concat(HIT_PARAMS.map(p => p.col));[cite: 1]

async function handleDataUpload(event) {
    const file = event.target.files[0];[cite: 1]
    if (!file) return;[cite: 1]
    
    const dataStatus = document.getElementById('dataStatus');[cite: 1]
    if (dataStatus) dataStatus.textContent = 'Processing ' + file.name + '...';[cite: 1]

    try {
        const rows = await parseWorkbookFile(file, 'RAW');[cite: 1]
        if (!rows.length) throw new Error('empty');[cite: 1]

        const headerMap = {};[cite: 1]
        NEEDED_FIELDS.forEach(f => {
            const h = findHeader(rows[0], [f]);[cite: 1]
            if (h) headerMap[f] = h;[cite: 1]
        });

        const rosterSnap = await getDocs(collection(db, 'roster'));[cite: 1]
        const nameToEmail = {};[cite: 1]
        rosterSnap.forEach(d => {
            const data = d.data();[cite: 1]
            nameToEmail[normalizeName(data.agentName)] = d.id;[cite: 1]
        });

        const UPPERCASE_FIELDS = ['FORM TYPE', 'MONTH', 'AGENT TENURE', 'OVERALL PASSRATE', 'CM'];[cite: 1]
        const TRIM_ONLY_FIELDS = ['BRAND', 'LINE OF BUSINESS', 'TEAM LEADER', 'CLUSTER', 'WEEKENDING'];[cite: 1]

        const trimmed = rows.map(r => {
            const out = {};[cite: 1]
            NEEDED_FIELDS.forEach(f => {
                const h = headerMap[f];[cite: 1]
                out[f] = h ? r[h] : '';[cite: 1]
            });
            UPPERCASE_FIELDS.forEach(f => { out[f] = normVal(out[f]); });[cite: 1]
            TRIM_ONLY_FIELDS.forEach(f => { out[f] = String(out[f] || '').trim(); });[cite: 1]
            ['RELIABLE', 'PERSONABLE', 'FAST', 'SAFE & SECURE', 'OVERALL SCORE'].forEach(k => {
                const n = parseFloat(out[k]);[cite: 1]
                out[k] = isNaN(n) ? null : (n <= 1 ? n * 100 : n);[cite: 1]
            });
            out.agentEmailLower = nameToEmail[normalizeName(out['AGENT/OFFICER NAME'])] || '';[cite: 1]
            return out;[cite: 1]
        }).filter(r => r['AGENT/OFFICER NAME']);[cite: 1]

        const hasIdColumn = !!headerMap['ID'];[cite: 1]
        const seenKeys = new Set();[cite: 1]
        const deduped = [];[cite: 1]
        trimmed.forEach(row => {
            const key = hasIdColumn ? String(row['ID']) : NEEDED_FIELDS.map(f => String(row[f])).join('||');[cite: 1]
            if (seenKeys.has(key)) return;[cite: 1]
            seenKeys.add(key);[cite: 1]
            deduped.push(row);[cite: 1]
        });

        await replaceAuditData(deduped);[cite: 1]

        cachedAuditRows = deduped;[cite: 1]
        if (dataStatus) dataStatus.innerHTML = `✅ ${deduped.length} rows loaded.`;[cite: 1]
        populateDropdownOptions(trimmed);[cite: 1]
        filterData();[cite: 1]
    } catch (err) {
        console.error(err);[cite: 1]
        if (dataStatus) dataStatus.innerHTML = `⚠️ Could not read this file.`;[cite: 1]
    }
}

/* ==========================================================================
   SUPERVISOR DASHBOARD — FILTERS + RENDER
   ========================================================================== */
function populateDropdownOptions(rows) {
    const map = {
        selectFormType: 'FORM TYPE',[cite: 1]
        selectBrand: 'BRAND',[cite: 1]
        selectMonth: 'MONTH',[cite: 1]
        selectWeekending: 'WEEKENDING',[cite: 1]
        selectTenure: 'AGENT TENURE',[cite: 1]
        selectTeamLeader: 'TEAM LEADER'[cite: 1]
    };
    Object.entries(map).forEach(([selId, field]) => {
        const sel = document.getElementById(selId);[cite: 1]
        if (!sel) return;[cite: 1]
        const current = sel.value;[cite: 1]
        const uniques = [...new Set(rows.map(r => r[field]).filter(Boolean))].sort();[cite: 1]
        sel.innerHTML = `<option value="ALL">(All)</option>` + uniques.map(v => `<option value="${v}">${v}</option>`).join('');[cite: 1]
        if (uniques.includes(current)) sel.value = current;[cite: 1]
    });
}

let cachedAuditRows = [];[cite: 1]

async function loadAllAuditData() {
    const snap = await getDocs(collection(db, 'auditData'));[cite: 1]
    cachedAuditRows = snap.docs.map(d => d.data());[cite: 1]
    return cachedAuditRows;[cite: 1]
}

function toggleUploadPanel() {
    const panel = document.getElementById('uploadPopover');[cite: 1]
    if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';[cite: 1]
}

function resetFilters() {
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader'][cite: 1]
        .forEach(id => { 
            const el = document.getElementById(id);[cite: 1]
            if (el) el.value = 'ALL';[cite: 1]
        });
    filterData();[cite: 1]
}

function filterData() {
    const rows = cachedAuditRows;[cite: 1]
    if (!rows.length) return;[cite: 1]

    const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : 'ALL';[cite: 1]

    const f = {
        formType: getVal('selectFormType'),[cite: 1]
        brand: getVal('selectBrand'),[cite: 1]
        month: getVal('selectMonth'),[cite: 1]
        weekending: getVal('selectWeekending'),[cite: 1]
        tenure: getVal('selectTenure'),[cite: 1]
        teamLeader: getVal('selectTeamLeader')[cite: 1]
    };

    const filtered = rows.filter(r =>
        (f.formType === 'ALL' || r['FORM TYPE'] === f.formType) &&[cite: 1]
        (f.brand === 'ALL' || r['BRAND'] === f.brand) &&[cite: 1]
        (f.month === 'ALL' || r['MONTH'] === f.month) &&[cite: 1]
        (f.weekending === 'ALL' || r['WEEKENDING'] === f.weekending) &&[cite: 1]
        (f.tenure === 'ALL' || r['AGENT TENURE'] === f.tenure) &&[cite: 1]
        (f.teamLeader === 'ALL' || r['TEAM LEADER'] === f.teamLeader)[cite: 1]
    );

    renderSupervisorDashboard(filtered);[cite: 1]
}

function tenureBucket(tenureStr) {
    const t = normVal(tenureStr);[cite: 1]
    if (t.includes('0-30')) return 'b1';[cite: 1]
    if (t.includes('31-60') || t.includes('61-90') || t.includes('31-90')) return 'b2';[cite: 1]
    return 'b3';[cite: 1]
}

function renderSupervisorDashboard(data) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };[cite: 1]
    const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };[cite: 1]

    if (!data.length) {
        setTxt('totalPassRateVal', '-');[cite: 1]
        setTxt('totalFailRateVal', '-');[cite: 1]
        setTxt('cmSuperstarVal', '-');[cite: 1]
        setTxt('cmUnderperformerVal', '-');[cite: 1]
        setHtml('leaderChart', '<div class="empty-note">No matching data.</div>');[cite: 1]
        setHtml('parameterChart', '<div class="empty-note">No matching data.</div>');[cite: 1]
        return;[cite: 1]
    }

    const avg = (key) => {
        const vals = data.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));[cite: 1]
        if (!vals.length) return null;[cite: 1]
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);[cite: 1]
    };

    const avgOverall = avg('OVERALL SCORE');[cite: 1]

    const lobScores = {};[cite: 1]
    data.forEach(r => {
        const lob = r['BRAND'] || 'Unspecified';[cite: 1]
        if (!lobScores[lob]) lobScores[lob] = { total: 0, count: 0 };[cite: 1]
        if (r['OVERALL SCORE'] !== null && r['OVERALL SCORE'] !== undefined) {
            lobScores[lob].total += r['OVERALL SCORE'];[cite: 1]
            lobScores[lob].count++;[cite: 1]
        }
    });
    
    const lobColors = ['#123e25', '#226f43', '#005a2b', '#8fa799', '#b1cfbe'];[cite: 1]
    const lobNames = Object.keys(lobScores).sort();[cite: 1]
    const parameterChartHtml = lobNames.map((lob, i) => {
        const s = lobScores[lob];[cite: 1]
        const a = s.count ? Math.round(s.total / s.count) : 0;[cite: 1]
        return `<div class="bar-wrapper">
            <div class="bar-value">${a}%</div>
            <div class="bar" style="background:${lobColors[i % lobColors.length]};height:${a}%;"></div>
            <div class="bar-label">${escapeHtml(lob)}</div>
        </div>`;[cite: 1]
    }).join('');[cite: 1]
    setHtml('parameterChart', parameterChartHtml);[cite: 1]

    const isPassed = (r) => r['OVERALL PASSRATE'] ? r['OVERALL PASSRATE'] === 'PASSED' : (r['OVERALL SCORE'] || 0) >= 85;[cite: 1]
    const passed = data.filter(isPassed).length;[cite: 1]
    const passPct = Math.round((passed / data.length) * 100);[cite: 1]
    setTxt('totalPassRateVal', passPct + '%');[cite: 1]
    setTxt('totalFailRateVal', (100 - passPct) + '%');[cite: 1]

    const buckets = { b1: [], b2: [], b3: [] };[cite: 1]
    data.forEach(r => buckets[tenureBucket(r['AGENT TENURE'])].push(r));[cite: 1]
    const bucketAvg = (arr) => {
        const vals = arr.map(r => r['OVERALL SCORE']).filter(v => v !== null && v !== undefined && !isNaN(v));[cite: 1]
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '-';[cite: 1]
    };
    
    setTxt('totalAuditNhip', buckets.b1.length || '-');[cite: 1]
    setTxt('totalAudit31', buckets.b2.length || '-');[cite: 1]
    setTxt('totalAudit91', buckets.b3.length || '-');[cite: 1]
    setTxt('totalAuditTotal', data.length);[cite: 1]
    setTxt('totalAvgNhip', bucketAvg(buckets.b1));[cite: 1]
    setTxt('totalAvg31', bucketAvg(buckets.b2));[cite: 1]
    setTxt('totalAvg91', bucketAvg(buckets.b3));[cite: 1]
    setTxt('totalAvgTotal', avgOverall === null ? '-' : avgOverall + '%');[cite: 1]

    const cmRows = data.filter(r => r['CM']);[cite: 1]
    if (cmRows.length) {
        const superstar = cmRows.filter(r => r['CM'] === 'SUPERSTAR').length;[cite: 1]
        setTxt('cmSuperstarVal', Math.round((superstar / cmRows.length) * 100) + '%');[cite: 1]
        setTxt('cmUnderperformerVal', Math.round(((cmRows.length - superstar) / cmRows.length) * 100) + '%');[cite: 1]
    }

    const tlScores = {};[cite: 1]
    data.forEach(r => {
        const tl = r['TEAM LEADER'] || 'Unassigned';[cite: 1]
        if (!tlScores[tl]) tlScores[tl] = { total: 0, count: 0 };[cite: 1]
        if (r['OVERALL SCORE'] !== null) { tlScores[tl].total += r['OVERALL SCORE']; tlScores[tl].count++; }[cite: 1]
    });
    
    const leaderChartHtml = Object.entries(tlScores).map(([tl, s]) => {
        const a = s.count ? Math.round(s.total / s.count) : 0;[cite: 1]
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label" title="${tl}">${tl}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${a}%;">${a}%</div></div>
        </div>`;[cite: 1]
    }).join('');[cite: 1]
    setHtml('leaderChart', leaderChartHtml);[cite: 1]

    const hitCounts = {};[cite: 1]
    data.forEach(r => {
        getRowIssues(r).forEach(issue => {
            const key = issue.label + '||' + issue.category;[cite: 1]
            hitCounts[key] = (hitCounts[key] || 0) + 1;[cite: 1]
        });
    });
    const sortedHits = Object.entries(hitCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);[cite: 1]
    const topHitsTable = document.getElementById('topHitsTable');[cite: 1, 3]
    if (topHitsTable) {
        const tbody = topHitsTable.querySelector('tbody');[cite: 1]
        if (tbody) {
            tbody.innerHTML = sortedHits.map(([key, count]) => {
                const [label, category] = key.split('||');[cite: 1]
                return `<tr><td style="text-align:left;">${label}</td><td>${category}</td><td>${count}</td></tr>`;[cite: 1]
            }).join('');[cite: 1]
        }
    }

    const distBuckets = [
        { label: '90–100%', test: s => s >= 90 },[cite: 1]
        { label: '80–89%', test: s => s >= 80 && s < 90 },[cite: 1]
        { label: '70–79%', test: s => s >= 70 && s < 80 },[cite: 1]
        { label: '60–69%', test: s => s >= 60 && s < 70 },[cite: 1]
        { label: 'Below 60%', test: s => s < 60 }[cite: 1]
    ];
    const clusterRows = {};[cite: 1]
    data.forEach(r => {
        const c = r['CLUSTER'] || 'Unassigned';[cite: 1]
        if (r['OVERALL SCORE'] === null || r['OVERALL SCORE'] === undefined) return;[cite: 1]
        if (!clusterRows[c]) clusterRows[c] = [];[cite: 1]
        clusterRows[c].push(r['OVERALL SCORE']);[cite: 1]
    });
    
    const clusterChart = document.getElementById('clusterChart');[cite: 3]
    if (clusterChart) {
        const clusterNames = Object.keys(clusterRows).sort();[cite: 1]
        clusterChart.innerHTML = clusterNames.map(c => {
            const scores = clusterRows[c];[cite: 1]
            const total = scores.length;[cite: 1]
            const avg = total ? Math.round(scores.reduce((a, b) => a + b, 0) / total) : 0;
            return `<div class="horizontal-bar-row">
                <div class="horizontal-label" title="${c}">${c}</div>
                <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${avg}%; background-color:#226f43;">${avg}%</div></div>
            </div>`;
        }).join('');
    }
}

/* ==========================================================================
   AGENT VIEW
   ========================================================================== */
async function renderAgentView() {
    const welcomeEl = document.getElementById('agentWelcomeName');[cite: 1, 3]
    if (welcomeEl) welcomeEl.textContent = 'Welcome, ' + (currentSession.agentName || currentSession.email);[cite: 1]

    const q = query(collection(db, 'auditData'), where('agentEmailLower', '==', currentSession.email));[cite: 1]
    const snap = await getDocs(q);[cite: 1]
    const myRows = snap.docs.map(d => d.data());[cite: 1]

    const emptyState = document.getElementById('agentEmptyState');[cite: 1, 3]
    const contentState = document.getElementById('agentContent');[cite: 1, 3]

    if (!myRows.length) {
        if (emptyState) emptyState.style.display = 'block';[cite: 1]
        if (contentState) contentState.style.display = 'none';[cite: 1]
        return;[cite: 1]
    }

    if (emptyState) emptyState.style.display = 'none';[cite: 1]
    if (contentState) contentState.style.display = 'flex';[cite: 1]

    const avg = (key) => {
        const vals = myRows.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));[cite: 1]
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;[cite: 1]
    };

    const tiles = [
        { label: 'Reliable', val: avg('RELIABLE') },[cite: 1]
        { label: 'Personable', val: avg('PERSONABLE') },[cite: 1]
        { label: 'Fast', val: avg('FAST') },[cite: 1]
        { label: 'Safe & Secure', val: avg('SAFE & SECURE') },[cite: 1]
        { label: 'Overall Score', val: avg('OVERALL SCORE') }[cite: 1]
    ];
    
    const scorecard = document.getElementById('agentScorecard');[cite: 1, 3]
    if (scorecard) {
        scorecard.innerHTML = tiles.map(t =>
            `<div class="score-tile"><div class="num">${t.val === null ? '-' : t.val + '%'}</div><div class="lbl">${t.label}</div></div>`[cite: 1]
        ).join('');[cite: 1]
    }

    const sorted = [...myRows].sort((a, b) => String(b['WEEKENDING'] || '').localeCompare(String(a['WEEKENDING'] || '')));[cite: 1]

    const auditRowHtml = (r) => {
        const issues = getRowIssues(r);[cite: 1]
        const score = r['OVERALL SCORE'];[cite: 1]
        const passed = r['OVERALL PASSRATE'] ? r['OVERALL PASSRATE'] === 'PASSED' : (score !== null && score >= 85);[cite: 1]
        const tagsHtml = issues.length
            ? issues.map(i => `<span class="tag ${i.category.replace(/\s|&/g, '')}">${escapeHtml(i.label)}</span>`).join('')[cite: 1]
            : `<span class="no-issues-note">✓ No parameters flagged on this audit.</span>`;[cite: 1]

        const comments = ['RELIABLE: ADDITIONAL COMMENTS', 'PERSONABLE: ADDITIONAL COMMENTS', 'FAST: ADDITIONAL COMMENTS'][cite: 1]
            .map(f => String(r[f] || '').trim())[cite: 1]
            .filter(c => c && !NON_ISSUE_VALUES.has(c.toUpperCase()));[cite: 1]
        const commentsHtml = comments.length
            ? `<div class="audit-comments">${comments.map(c => `<p>${escapeHtml(c)}</p>`).join('')}</div>`[cite: 1]
            : '';[cite: 1]

        return `<div class="audit-row">
            <div class="audit-head">
                <span>${escapeHtml(r['WEEKENDING'])} · ${escapeHtml(r['FORM TYPE'])} · ${escapeHtml(r['BRAND'])}</span>
                <span class="score-pill ${passed ? 'pass-pill' : 'fail-pill'}">${score === null ? '-' : score + '%'}</span>
            </div>
            <div class="audit-meta">Team Leader: ${escapeHtml(r['TEAM LEADER']) || '—'} · Cluster: ${escapeHtml(r['CLUSTER']) || '—'}</div>
            <div>${tagsHtml}</div>
            ${commentsHtml}
        </div>`;[cite: 1]
    };

    const groups = {};[cite: 1]
    sorted.forEach(r => {
        const m = normVal(r['MONTH']) || 'UNSPECIFIED';[cite: 1]
        if (!groups[m]) groups[m] = [];[cite: 1]
        groups[m].push(r);[cite: 1]
    });

    const orderedMonths = Object.keys(groups).sort((a, b) => {
        const aMax = groups[a].reduce((mx, r) => String(r['WEEKENDING'] || '') > mx ? String(r['WEEKENDING'] || '') : mx, '');[cite: 1]
        const bMax = groups[b].reduce((mx, r) => String(r['WEEKENDING'] || '') > mx ? String(r['WEEKENDING'] || '') : mx, '');[cite: 1]
        return bMax.localeCompare(aMax);[cite: 1]
    });

    const auditList = document.getElementById('agentAuditList');[cite: 1, 3]
    if (auditList) {
        auditList.innerHTML = orderedMonths.map((month, idx) => {
            const rows = groups[month];[cite: 1]
            const monthAvg = (() => {
                const vals = rows.map(r => r['OVERALL SCORE']).filter(v => v !== null && v !== undefined && !isNaN(v));[cite: 1]
                return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;[cite: 1]
            })();
            return `<details class="month-group" ${idx === 0 ? 'open' : ''}>
                <summary class="month-summary">
                    <span>${month} <span class="month-count">(${rows.length} audit${rows.length === 1 ? '' : 's'})</span></span>
                    <span class="month-avg">${monthAvg === null ? '' : 'avg ' + monthAvg + '%'}</span>
                </summary>
                <div class="month-body">${rows.map(auditRowHtml).join('')}</div>
            </details>`;[cite: 1]
        }).join('');[cite: 1]
    }
}

/* ==========================================================================
   EXPOSE TO WINDOW
   ========================================================================== */
window.switchAuthTab = switchAuthTab;[cite: 1]
window.setSignupRole = setSignupRole;[cite: 1]
window.handleSignup = handleSignup;[cite: 1]
window.handleLogin = handleLogin;[cite: 1]
window.logout = logout;[cite: 1]
window.filterData = filterData;[cite: 1]
window.resetFilters = resetFilters;[cite: 1]
window.toggleUploadPanel = toggleUploadPanel;[cite: 1]
window.handleRosterUpload = handleRosterUpload;[cite: 1]
window.handleDataUpload = handleDataUpload;[cite: 1]
window.resyncAgentEmails = resyncAgentEmails;[cite: 1]

// Initialize layout roles safely
setSignupRole('agent');[cite: 1]

/* ==========================================================================
   INITIALIZE DOM WORKSPACE LISTENERS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Intercept login authentication submission interface
    const loginForm = document.getElementById('loginForm');[cite: 3]
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleLogin();
        });
    }

    // Attach Log out interaction
    const btnLogout = document.getElementById('btnLogout');[cite: 3]
    if (btnLogout) {
        btnLogout.addEventListener('click', logout);
    }

    // Attach Filter management interaction
    const btnResetFilters = document.getElementById('btnResetFilters');[cite: 3]
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', resetFilters);
    }
    
    // Attach dynamic filter modification event listeners to your dropdown controls
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterData);
    });
});
