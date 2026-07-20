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

const TEAM_LEADER_INVITE_CODE = 'SMART-TL-2026';
const QUALITY_INVITE_CODE = 'SMART-QA-2026';

/* Firestore write batches max out at 500 ops — chunk anything bigger */
async function batchWriteDocs(collectionName, docs, idFn) {
    const chunks = [];
    for (let i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));
    for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(d => {
            const ref = idFn ? doc(db, collectionName, idFn(d)) : doc(collection(db, collectionName));
            batch.set(ref, d);
        });
        await batch.commit();
    }
}

async function clearCollection(collectionName) {
    const snap = await getDocs(collection(db, collectionName));
    const ids = snap.docs.map(d => d.id);
    for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, collectionName, id)));
        await batch.commit();
    }
}

async function replaceAuditData(rows) {
    const metaRef = doc(db, 'meta', 'auditData');
    const metaSnap = await getDoc(metaRef);
    const prevCount = metaSnap.exists() ? (metaSnap.data().count || 0) : 0;

    for (let i = 0; i < prevCount; i += 400) {
        const end = Math.min(i + 400, prevCount);
        const batch = writeBatch(db);
        for (let j = i; j < end; j++) batch.delete(doc(db, 'auditData', 'row_' + j));
        await batch.commit();
    }

    for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((row, idx) => batch.set(doc(db, 'auditData', 'row_' + (i + idx)), row));
        await batch.commit();
    }

    await setDoc(metaRef, { count: rows.length, updatedAt: Date.now() });
}

/* ==========================================================================
   SESSION
   ========================================================================== */
let currentSession = null;

/* ==========================================================================
   AUTH UI
   ========================================================================== */
function switchAuthTab(which) {
    document.getElementById('tabLogin')?.classList.toggle('active', which === 'login');
    document.getElementById('tabSignup')?.classList.toggle('active', which === 'signup');
    
    const loginPane = document.getElementById('loginPane');
    if (loginPane) loginPane.style.display = which === 'login' ? 'block' : 'none';
    
    const signupPane = document.getElementById('signupPane');
    if (signupPane) signupPane.style.display = which === 'login' ? 'none' : 'block';
}

let signupRole = 'agent';
function setSignupRole(role) {
    signupRole = role;
    document.getElementById('roleAgentLabel')?.classList.toggle('checked', role === 'agent');
    document.getElementById('roleTeamLeaderLabel')?.classList.toggle('checked', role === 'team_leader');
    document.getElementById('roleQualityLabel')?.classList.toggle('checked', role === 'quality');
    
    const needsCode = role === 'team_leader' || role === 'quality';
    const codeGroup = document.getElementById('supervisorCodeGroup');
    if (codeGroup) codeGroup.style.display = needsCode ? 'block' : 'none';
    
    const codeLabel = document.getElementById('supervisorCodeLabel');
    if (codeLabel && needsCode) {
        codeLabel.textContent = role === 'team_leader' ? 'Team Leader Invite Code' : 'Quality Invite Code';
    }
}

function showAuthMsg(elId, text, ok) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    el.className = 'auth-msg ' + (ok ? 'ok' : 'error');
    el.style.display = 'block'; 
}

let authFlowInProgress = false;
const REQUIRED_EMAIL_DOMAIN = '@pldt.com';

async function handleSignup() {
    const emailEl = document.getElementById('signupEmail');
    const pwEl = document.getElementById('signupPassword');
    const pw2El = document.getElementById('signupPassword2');
    
    const email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    const pw = pwEl ? pwEl.value : '';
    const pw2 = pw2El ? pw2El.value : '';

    if (!email || !email.includes('@')) return showAuthMsg('authMessage', 'Enter a valid work email.', false);
    if (!email.endsWith(REQUIRED_EMAIL_DOMAIN)) return showAuthMsg('authMessage', `Please sign up using your ${REQUIRED_EMAIL_DOMAIN} work email.`, false);
    if (pw.length < 6) return showAuthMsg('authMessage', 'Password must be at least 6 characters.', false);
    if (pw !== pw2) return showAuthMsg('authMessage', 'Passwords do not match.', false);

    authFlowInProgress = true;
    try {
        if (signupRole === 'team_leader' || signupRole === 'quality') {
            const requiredCode = signupRole === 'team_leader' ? TEAM_LEADER_INVITE_CODE : QUALITY_INVITE_CODE;
            const codeEl = document.getElementById('supervisorCode');
            const code = codeEl ? codeEl.value.trim() : '';
            if (code !== requiredCode) return showAuthMsg('authMessage', 'Invalid invite code.', false);

            let cred;
            try {
                cred = await createUserWithEmailAndPassword(auth, email, pw);
            } catch (err) {
                return showAuthMsg('authMessage', friendlyAuthError(err), false);
            }
            await setDoc(doc(db, 'users', cred.user.uid), { email, role: signupRole });
            await signOut(auth);
            showAuthMsg('authMessage', `${signupRole === 'team_leader' ? 'Team Leader' : 'Quality'} account created. You can log in now.`, true);
            clearSignupForm();
            setTimeout(() => switchAuthTab('login'), 1200);
            return;
        }

        let cred;
        try {
            cred = await createUserWithEmailAndPassword(auth, email, pw);
        } catch (err) {
            return showAuthMsg('authMessage', friendlyAuthError(err), false);
        }

        try {
            const rosterSnap = await getDoc(doc(db, 'roster', email));
            if (!rosterSnap.exists()) {
                await deleteUser(cred.user);
                return showAuthMsg('authMessage', 'This email was not found on the agent roster. Ask your supervisor to add you, then try again.', false);
            }
            const match = rosterSnap.data();

            await setDoc(doc(db, 'users', cred.user.uid), {
                email,
                role: 'agent',
                agentName: match.agentName,
                agentId: match.agentId || ''
            });
            await signOut(auth);
            showAuthMsg('authMessage', `Account created and matched to "${match.agentName}". You can log in now.`, true);
            clearSignupForm();
            setTimeout(() => switchAuthTab('login'), 1200);
        } catch (err) {
            try { await deleteUser(cred.user); } catch (e2) {}
            showAuthMsg('authMessage', friendlyAuthError(err), false);
        }
    } finally {
        authFlowInProgress = false;
    }
}

function clearSignupForm() {
    const email = document.getElementById('signupEmail');
    const pw = document.getElementById('signupPassword');
    const pw2 = document.getElementById('signupPassword2');
    const code = document.getElementById('supervisorCode');
    
    if (email) email.value = '';
    if (pw) pw.value = '';
    if (pw2) pw2.value = '';
    if (code) code.value = '';
}

async function handleLogin() {
    const emailEl = document.getElementById('loginEmail');
    const pwEl = document.getElementById('loginPassword');
    
    const email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    const pw = pwEl ? pwEl.value : '';
    if (!email || !pw) return showAuthMsg('authMessage', 'Enter your email and password.', false);

    authFlowInProgress = true;
    try {
        const cred = await signInWithEmailAndPassword(auth, email, pw);
        const profileSnap = await getDoc(doc(db, 'users', cred.user.uid));
        if (!profileSnap.exists()) {
            await signOut(auth);
            return showAuthMsg('authMessage', 'No profile found for this account. Contact your supervisor.', false);
        }
        
        currentSession = { uid: cred.user.uid, ...profileSnap.data() };
        if (emailEl) emailEl.value = '';
        if (pwEl) pwEl.value = '';
        await enterApp();
    } catch (err) {
        showAuthMsg('authMessage', friendlyAuthError(err), false);
    } finally {
        authFlowInProgress = false;
    }
}

function logout() {
    signOut(auth);
}

function friendlyAuthError(err) {
    const code = err && err.code ? err.code : '';
    if (code.includes('email-already-in-use')) return 'An account with this email already exists. Try logging in.';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Incorrect email or password.';
    if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (code.includes('invalid-email')) return 'Enter a valid email address.';
    return 'Something went wrong: ' + (err && err.message ? err.message : 'please try again.');
}

function resetToLoggedOutState() {
    currentSession = null;
    cachedAuditRows = [];
    
    const appScreen = document.getElementById('appScreen');
    if (appScreen) appScreen.style.display = 'none';
    
    const authScreen = document.getElementById('authScreen');
    if (authScreen) authScreen.style.display = 'flex';
    
    const sessionChip = document.getElementById('sessionChip');
    if (sessionChip) sessionChip.style.display = 'none';
    
    const loginEmail = document.getElementById('loginEmail');
    if (loginEmail) loginEmail.value = '';
    
    const loginPassword = document.getElementById('loginPassword');
    if (loginPassword) loginPassword.value = '';
    
    const authMessage = document.getElementById('authMessage');
    if (authMessage) {
        authMessage.textContent = '';
        authMessage.style.display = 'none';
    }
    
    clearSignupForm();
    switchAuthTab('login');

    const agentAuditList = document.getElementById('agentAuditList');
    if (agentAuditList) agentAuditList.innerHTML = '';
    
    const agentScorecard = document.getElementById('agentScorecard');
    if (agentScorecard) agentScorecard.innerHTML = '';
    
    const agentWelcomeName = document.getElementById('agentWelcomeName');
    if (agentWelcomeName) agentWelcomeName.textContent = 'Welcome';
    
    const rosterStatus = document.getElementById('rosterStatus');
    if (rosterStatus) rosterStatus.textContent = 'No roster loaded yet.';
    
    const dataStatus = document.getElementById('dataStatus');
    if (dataStatus) dataStatus.textContent = 'No audit data loaded yet.';
    
    const resyncStatus = document.getElementById('resyncStatus');
    if (resyncStatus) resyncStatus.textContent = 'Use this if agents uploaded/updated after data was already loaded...';
    
    const uploadPopover = document.getElementById('uploadPopover');
    if (uploadPopover) uploadPopover.style.display = 'none';
}

onAuthStateChanged(auth, async (user) => {
    if (authFlowInProgress) return;
    if (!user) {
        resetToLoggedOutState();
        return;
    }
    const profileSnap = await getDoc(doc(db, 'users', user.uid));
    if (!profileSnap.exists()) {
        await signOut(auth);
        return;
    }
    currentSession = { uid: user.uid, ...profileSnap.data() };
    await enterApp();
});

async function enterApp() {
    const authScreen = document.getElementById('authScreen');
    if (authScreen) authScreen.style.display = 'none';
    
    const appScreen = document.getElementById('appScreen');
    if (appScreen) appScreen.style.display = 'flex';
    
    const sessionChip = document.getElementById('sessionChip');
    if (sessionChip) sessionChip.style.display = 'flex';

    const roleLabels = { quality: '👤 Quality · ', team_leader: '👤 Team Leader · ', supervisor: '👤 Quality · ', agent: '👤 Agent · ' };
    const sessionLabel = document.getElementById('sessionLabel');
    if (sessionLabel) sessionLabel.textContent = (roleLabels[currentSession.role] || '👤 ') + currentSession.email;

    const canViewDashboard = currentSession.role === 'quality' || currentSession.role === 'team_leader' || currentSession.role === 'supervisor';
    const canUpload = currentSession.role === 'quality' || currentSession.role === 'supervisor';

    const supervisorSidebar = document.getElementById('appSidebar');
    if (supervisorSidebar) supervisorSidebar.style.display = canViewDashboard ? 'flex' : 'none';
    
    const supervisorView = document.getElementById('supervisorView');
    if (supervisorView) supervisorView.style.display = canViewDashboard ? 'flex' : 'none';
    
    const agentView = document.getElementById('agentView');
    if (agentView) agentView.style.display = canViewDashboard ? 'none' : 'flex';
    
    const uploadIconBtn = document.getElementById('uploadIconBtn');
    if (uploadIconBtn) uploadIconBtn.style.display = canUpload ? 'flex' : 'none';

    if (canViewDashboard) {
        if (canUpload) await refreshRosterStatus();
        const rows = await loadAllAuditData();
        if (rows.length) {
            const dataStatus = document.getElementById('dataStatus');
            if (canUpload && dataStatus) dataStatus.innerHTML = `✅ ${rows.length} audit rows loaded.`;
            populateDropdownOptions(rows);
            filterData();
        }
    } else {
        await renderAgentView();
    }
}

/* ==========================================================================
   HIT-PARAMETER CONFIG
   ========================================================================== */
const NON_ISSUE_VALUES = new Set(['', 'NO OPPORTUNITY', 'NA', 'N/A', 'NO', 'NONE']);

const HIT_PARAMS = [
    { col: 'IRRELEVANT SOLUTION', category: 'Reliable', label: 'Irrelevant solution given', type: 'descriptive' },
    { col: 'INCOMPLETE SOLUTION', category: 'Reliable', label: 'Incomplete solution given', type: 'descriptive' },
    { col: 'UNTIMELY SOLUTION ( ZTP)', category: 'Reliable', label: 'Untimely solution (ZTP)', type: 'descriptive' },
    { col: 'UNCLEAR SOLUTION', category: 'Reliable', label: 'Unclear solution given', type: 'descriptive' },
    { col: 'Poor Listening Skills?', category: 'Personable', label: 'Poor listening skills', type: 'descriptive' },
    { col: 'Customer Validation and Empathy Gap?', category: 'Personable', label: 'Empathy / validation gap', type: 'descriptive' },
    { col: 'Did not adjust the tone/pace to match the customer?', category: 'Personable', label: 'Tone/pace not matched to customer', type: 'descriptive' },
    { col: 'Did not adjust to the customers language?', category: 'Personable', label: 'Language not adjusted to customer', type: 'descriptive' },
    { col: 'Negative Words, Phrasing and Limitations?', category: 'Personable', label: 'Negative words / phrasing used', type: 'descriptive' },
    { col: 'Unfriendly/discourteous/sarcastic?', category: 'Personable', label: 'Unfriendly, discourteous, or sarcastic tone', type: 'descriptive' },
    { col: 'Sounded transactional or robotic?', category: 'Personable', label: 'Sounded transactional or robotic', type: 'descriptive' },
    { col: 'FAST: Were there other Agent factors observed that affected the customer experience?', category: 'Fast', label: 'Other agent factor slowed the resolution', type: 'descriptive' },
    { col: 'DID WE FOLLOW THE CUSTOMER AUTHENTICATION PROCESS?', category: 'Safe & Secure', label: 'Customer authentication process missed', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE FOLLOW THE DATA PRIVACY POLICY?', category: 'Safe & Secure', label: 'Data privacy policy not followed', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE UPDATE THE CUSTOMER INFORMATION IN THE TOOL?', category: 'Safe & Secure', label: 'Customer info not updated in tool', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE FOLLOW THE CSAT/NPS PROCESS?', category: 'Safe & Secure', label: 'CSAT/NPS process not followed', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE FOLLOW THE SYSTEM DOCUMENTATION PROCESS?', category: 'Safe & Secure', label: 'System documentation process missed', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE FOLLOW THE SYSTEM TAGGING PROCESS?', category: 'Safe & Secure', label: 'System tagging process missed', type: 'boolean', hitValue: 'NO' },
    { col: 'DID WE FOLLOW CORRECT GRAMMAR, TECHNICAL WRITING & THE PRESCRIBED LANGUAGE?', category: 'Safe & Secure', label: 'Grammar / prescribed language standard missed', type: 'boolean', hitValue: 'NO' },
    { col: "IS THIS A POTENTIAL CUSTOMER MISTREAT?", category: 'Mistreat', label: 'Potential customer mistreat flagged', type: 'boolean', hitValue: 'YES' }
];

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normVal(v) {
    return (v === undefined || v === null) ? '' : String(v).trim().toUpperCase();
}

function normalizeName(str) {
    return String(str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[.,'-]/g, ' ')
        .replace(/\b(JR|SR|II|III|IV)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getRowIssues(row) {
    const issues = [];
    HIT_PARAMS.forEach(p => {
        const raw = row[p.col];
        const v = normVal(raw);
        if (!v) return;

        if (p.type === 'boolean') {
            if (v === p.hitValue) issues.push({ label: p.label, category: p.category });
            return;
        }
        if (!NON_ISSUE_VALUES.has(v)) {
            const detail = v !== 'YES' ? String(raw).trim() : '';
            issues.push({ label: detail ? `${p.label} — ${detail}` : p.label, category: p.category });
        }
    });
    return issues;
}

/* ==========================================================================
   FILE PARSING
   ========================================================================== */
function parseWorkbookFile(file, preferSheetNameContains) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                let sheetName = wb.SheetNames[0];
                if (preferSheetNameContains) {
                    const found = wb.SheetNames.find(n => n.toUpperCase().includes(preferSheetNameContains));
                    if (found) sheetName = found;
                }
                const ws = wb.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
                resolve(json);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function findHeader(row, candidates) {
    const keys = Object.keys(row);
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());
        if (hit) return hit;
    }
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase().includes(cand.toLowerCase()));
        if (hit) return hit;
    }
    return null;
}

/* ==========================================================================
   ROSTER UPLOAD
   ========================================================================== */
async function handleRosterUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const rosterStatus = document.getElementById('rosterStatus');
    if (rosterStatus) rosterStatus.textContent = 'Processing ' + file.name + '...';

    try {
        const rows = await parseWorkbookFile(file);
        if (!rows.length) throw new Error('empty');

        const emailKey = findHeader(rows[0], ['Email', 'Work Email']);
        const nameKey = findHeader(rows[0], ['Agent Name', 'AGENT/OFFICER NAME', 'Name']);
        const idKey = findHeader(rows[0], ['ID', 'Employee ID', 'EE number/ID number', 'Agent ID']);

        if (!emailKey || !nameKey) throw new Error('missing columns');

        const roster = rows
            .map(r => ({
                email: String(r[emailKey] || '').trim().toLowerCase(),
                agentName: String(r[nameKey] || '').trim(),
                agentId: idKey ? String(r[idKey] || '').trim() : ''
            }))
            .filter(r => r.email && r.agentName);

        await clearCollection('roster');
        await batchWriteDocs('roster', roster, (r) => r.email);

        if (rosterStatus) rosterStatus.innerHTML = `✅ Roster loaded: ${roster.length} agents matched.`;
    } catch (err) {
        console.error(err);
        if (rosterStatus) rosterStatus.innerHTML = `⚠️ Could not read roster. Expect columns: Email, Agent Name, ID.`;
    }
}

async function refreshRosterStatus() {
    const snap = await getDocs(collection(db, 'roster'));
    const rosterStatus = document.getElementById('rosterStatus');
    if (snap.size && rosterStatus) {
        rosterStatus.innerHTML = `✅ Roster loaded: ${snap.size} agents.`;
    }
}

async function resyncAgentEmails() {
    const statusEl = document.getElementById('resyncStatus');
    if (statusEl) statusEl.textContent = 'Re-syncing...';

    try {
        const rosterSnap = await getDocs(collection(db, 'roster'));
        const nameToEmail = {};
        rosterSnap.forEach(d => {
            const data = d.data();
            nameToEmail[normalizeName(data.agentName)] = d.id;
        });

        const dataSnap = await getDocs(collection(db, 'auditData'));
        const docs = dataSnap.docs;

        let matched = 0, unmatched = 0;
        const unmatchedNames = new Set();

        for (let i = 0; i < docs.length; i += 400) {
            const chunk = docs.slice(i, i + 400);
            const batch = writeBatch(db);
            chunk.forEach(d => {
                const row = d.data();
                const key = normalizeName(row['AGENT/OFFICER NAME']);
                const email = nameToEmail[key] || '';
                if (email) matched++; else { unmatched++; if (key) unmatchedNames.add(row['AGENT/OFFICER NAME']); }
                batch.update(doc(db, 'auditData', d.id), { agentEmailLower: email });
            });
            await batch.commit();
        }

        let msg = `✅ Re-synced: ${matched} rows matched, ${unmatched} unmatched rows.`;
        if (statusEl) statusEl.textContent = msg;
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = '⚠️ Re-sync failed.';
    }
}

/* ==========================================================================
   RAW DATA UPLOAD
   ========================================================================== */
const NEEDED_FIELDS = [
    'ID', 'FORM TYPE', 'BRAND', 'LINE OF BUSINESS', 'AGENT/OFFICER NAME', 'AGENT TENURE',
    'TEAM LEADER', 'CLUSTER', 'WEEKENDING', 'MONTH', 'MISTREAT',
    'RELIABLE', 'PERSONABLE', 'FAST', 'SAFE & SECURE', 'OVERALL SCORE',
    'EE number/ID number', 'OVERALL PASSRATE', 'CM',
    'RELIABLE: ADDITIONAL COMMENTS', 'PERSONABLE: ADDITIONAL COMMENTS', 'FAST: ADDITIONAL COMMENTS'
].concat(HIT_PARAMS.map(p => p.col));

async function handleDataUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const dataStatus = document.getElementById('dataStatus');
    if (dataStatus) dataStatus.textContent = 'Processing ' + file.name + '...';

    try {
        const rows = await parseWorkbookFile(file, 'RAW');
        if (!rows.length) throw new Error('empty');

        const headerMap = {};
        NEEDED_FIELDS.forEach(f => {
            const h = findHeader(rows[0], [f]);
            if (h) headerMap[f] = h;
        });

        const rosterSnap = await getDocs(collection(db, 'roster'));
        const nameToEmail = {};
        rosterSnap.forEach(d => {
            const data = d.data();
            nameToEmail[normalizeName(data.agentName)] = d.id;
        });

        const UPPERCASE_FIELDS = ['FORM TYPE', 'MONTH', 'AGENT TENURE', 'OVERALL PASSRATE', 'CM'];
        const TRIM_ONLY_FIELDS = ['BRAND', 'LINE OF BUSINESS', 'TEAM LEADER', 'CLUSTER', 'WEEKENDING'];

        const trimmed = rows.map(r => {
            const out = {};
            NEEDED_FIELDS.forEach(f => {
                const h = headerMap[f];
                out[f] = h ? r[h] : '';
            });
            UPPERCASE_FIELDS.forEach(f => { out[f] = normVal(out[f]); });
            TRIM_ONLY_FIELDS.forEach(f => { out[f] = String(out[f] || '').trim(); });
            ['RELIABLE', 'PERSONABLE', 'FAST', 'SAFE & SECURE', 'OVERALL SCORE'].forEach(k => {
                const n = parseFloat(out[k]);
                out[k] = isNaN(n) ? null : (n <= 1 ? n * 100 : n);
            });
            out.agentEmailLower = nameToEmail[normalizeName(out['AGENT/OFFICER NAME'])] || '';
            return out;
        }).filter(r => r['AGENT/OFFICER NAME']);

        const hasIdColumn = !!headerMap['ID'];
        const seenKeys = new Set();
        const deduped = [];
        trimmed.forEach(row => {
            const key = hasIdColumn ? String(row['ID']) : NEEDED_FIELDS.map(f => String(row[f])).join('||');
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            deduped.push(row);
        });

        await replaceAuditData(deduped);

        cachedAuditRows = deduped;
        if (dataStatus) dataStatus.innerHTML = `✅ ${deduped.length} rows loaded.`;
        populateDropdownOptions(trimmed);
        filterData();
    } catch (err) {
        console.error(err);
        if (dataStatus) dataStatus.innerHTML = `⚠️ Could not read this file.`;
    }
}

/* ==========================================================================
   SUPERVISOR DASHBOARD — FILTERS + RENDER
   ========================================================================== */
function populateDropdownOptions(rows) {
    const map = {
        selectFormType: 'FORM TYPE',
        selectBrand: 'BRAND',
        selectMonth: 'MONTH',
        selectWeekending: 'WEEKENDING',
        selectTenure: 'AGENT TENURE',
        selectTeamLeader: 'TEAM LEADER'
    };
    Object.entries(map).forEach(([selId, field]) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const current = sel.value;
        const uniques = [...new Set(rows.map(r => r[field]).filter(Boolean))].sort();
        sel.innerHTML = `<option value="ALL">(All)</option>` + uniques.map(v => `<option value="${v}">${v}</option>`).join('');
        if (uniques.includes(current)) sel.value = current;
    });
}

let cachedAuditRows = [];

async function loadAllAuditData() {
    const snap = await getDocs(collection(db, 'auditData'));
    cachedAuditRows = snap.docs.map(d => d.data());
    return cachedAuditRows;
}

function toggleUploadPanel() {
    const panel = document.getElementById('uploadPopover');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function resetFilters() {
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader']
        .forEach(id => { 
            const el = document.getElementById(id);
            if (el) el.value = 'ALL';
        });
    filterData();
}

function filterData() {
    const rows = cachedAuditRows;
    if (!rows.length) return;

    const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : 'ALL';

    const f = {
        formType: getVal('selectFormType'),
        brand: getVal('selectBrand'),
        month: getVal('selectMonth'),
        weekending: getVal('selectWeekending'),
        tenure: getVal('selectTenure'),
        teamLeader: getVal('selectTeamLeader')
    };

    const filtered = rows.filter(r =>
        (f.formType === 'ALL' || r['FORM TYPE'] === f.formType) &&
        (f.brand === 'ALL' || r['BRAND'] === f.brand) &&
        (f.month === 'ALL' || r['MONTH'] === f.month) &&
        (f.weekending === 'ALL' || r['WEEKENDING'] === f.weekending) &&
        (f.tenure === 'ALL' || r['AGENT TENURE'] === f.tenure) &&
        (f.teamLeader === 'ALL' || r['TEAM LEADER'] === f.teamLeader)
    );

    renderSupervisorDashboard(filtered);
}

function tenureBucket(tenureStr) {
    const t = normVal(tenureStr);
    if (t.includes('0-30')) return 'b1';
    if (t.includes('31-60') || t.includes('61-90') || t.includes('31-90')) return 'b2';
    return 'b3';
}

function renderSupervisorDashboard(data) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

    if (!data.length) {
        setTxt('totalPassRateVal', '-');
        setTxt('totalFailRateVal', '-');
        setTxt('cmSuperstarVal', '-');
        setTxt('cmUnderperformerVal', '-');
        setHtml('leaderChart', '<div class="empty-note">No matching data.</div>');
        setHtml('parameterChart', '<div class="empty-note">No matching data.</div>');
        return;
    }

    const avg = (key) => {
        const vals = data.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
        if (!vals.length) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const avgOverall = avg('OVERALL SCORE');

    const lobScores = {};
    data.forEach(r => {
        const lob = r['BRAND'] || 'Unspecified';
        if (!lobScores[lob]) lobScores[lob] = { total: 0, count: 0 };
        if (r['OVERALL SCORE'] !== null && r['OVERALL SCORE'] !== undefined) {
            lobScores[lob].total += r['OVERALL SCORE'];
            lobScores[lob].count++;
        }
    });
    
    const lobColors = ['#123e25', '#226f43', '#005a2b', '#8fa799', '#b1cfbe'];
    const lobNames = Object.keys(lobScores).sort();
    const parameterChartHtml = lobNames.map((lob, i) => {
        const s = lobScores[lob];
        const a = s.count ? Math.round(s.total / s.count) : 0;
        return `<div class="bar-wrapper">
            <div class="bar-value">${a}%</div>
            <div class="bar" style="background:${lobColors[i % lobColors.length]};height:${a}%;"></div>
            <div class="bar-label">${escapeHtml(lob)}</div>
        </div>`;
    }).join('');
    setHtml('parameterChart', parameterChartHtml);

    const isPassed = (r) => r['OVERALL PASSRATE'] ? r['OVERALL PASSRATE'] === 'PASSED' : (r['OVERALL SCORE'] || 0) >= 85;
    const passed = data.filter(isPassed).length;
    const passPct = Math.round((passed / data.length) * 100);
    setTxt('totalPassRateVal', passPct + '%');
    setTxt('totalFailRateVal', (100 - passPct) + '%');

    const buckets = { b1: [], b2: [], b3: [] };
    data.forEach(r => buckets[tenureBucket(r['AGENT TENURE'])].push(r));
    const bucketAvg = (arr) => {
        const vals = arr.map(r => r['OVERALL SCORE']).filter(v => v !== null && v !== undefined && !isNaN(v));
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '-';
    };
    
    setTxt('totalAuditNhip', buckets.b1.length || '-');
    setTxt('totalAudit31', buckets.b2.length || '-');
    setTxt('totalAudit91', buckets.b3.length || '-');
    setTxt('totalAuditTotal', data.length);
    setTxt('totalAvgNhip', bucketAvg(buckets.b1));
    setTxt('totalAvg31', bucketAvg(buckets.b2));
    setTxt('totalAvg91', bucketAvg(buckets.b3));
    setTxt('totalAvgTotal', avgOverall === null ? '-' : avgOverall + '%');

    const cmRows = data.filter(r => r['CM']);
    if (cmRows.length) {
        const superstar = cmRows.filter(r => r['CM'] === 'SUPERSTAR').length;
        setTxt('cmSuperstarVal', Math.round((superstar / cmRows.length) * 100) + '%');
        setTxt('cmUnderperformerVal', Math.round(((cmRows.length - superstar) / cmRows.length) * 100) + '%');
    }

    const tlScores = {};
    data.forEach(r => {
        const tl = r['TEAM LEADER'] || 'Unassigned';
        if (!tlScores[tl]) tlScores[tl] = { total: 0, count: 0 };
        if (r['OVERALL SCORE'] !== null) { tlScores[tl].total += r['OVERALL SCORE']; tlScores[tl].count++; }
    });
    
    const leaderChartHtml = Object.entries(tlScores).map(([tl, s]) => {
        const a = s.count ? Math.round(s.total / s.count) : 0;
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label" title="${tl}">${tl}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${a}%;">${a}%</div></div>
        </div>`;
    }).join('');
    setHtml('leaderChart', leaderChartHtml);

    const hitCounts = {};
    data.forEach(r => {
        getRowIssues(r).forEach(issue => {
            const key = issue.label + '||' + issue.category;
            hitCounts[key] = (hitCounts[key] || 0) + 1;
        });
    });
    const sortedHits = Object.entries(hitCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topHitsTable = document.getElementById('topHitsTable');
    if (topHitsTable) {
        const tbody = topHitsTable.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = sortedHits.map(([key, count]) => {
                const [label, category] = key.split('||');
                return `<tr><td style="text-align:left;">${label}</td><td>${category}</td><td>${count}</td></tr>`;
            }).join('');
        }
    }

    const distBuckets = [
        { label: '90–100%', test: s => s >= 90 },
        { label: '80–89%', test: s => s >= 80 && s < 90 },
        { label: '70–79%', test: s => s >= 70 && s < 80 },
        { label: '60–69%', test: s => s >= 60 && s < 70 },
        { label: 'Below 60%', test: s => s < 60 }
    ];
    const clusterRows = {};
    data.forEach(r => {
        const c = r['CLUSTER'] || 'Unassigned';
        if (r['OVERALL SCORE'] === null || r['OVERALL SCORE'] === undefined) return;
        if (!clusterRows[c]) clusterRows[c] = [];
        clusterRows[c].push(r['OVERALL SCORE']);
    });
    
    const clusterChart = document.getElementById('clusterChart');
    if (clusterChart) {
        const clusterNames = Object.keys(clusterRows).sort();
        clusterChart.innerHTML = clusterNames.map(c => {
            const scores = clusterRows[c];
            const total = scores.length;
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
    const welcomeEl = document.getElementById('agentWelcomeName');
    if (welcomeEl) welcomeEl.textContent = 'Welcome, ' + (currentSession.agentName || currentSession.email);

    const q = query(collection(db, 'auditData'), where('agentEmailLower', '==', currentSession.email));
    const snap = await getDocs(q);
    const myRows = snap.docs.map(d => d.data());

    const emptyState = document.getElementById('agentEmptyState');
    const contentState = document.getElementById('agentContent');

    if (!myRows.length) {
        if (emptyState) emptyState.style.display = 'block';
        if (contentState) contentState.style.display = 'none';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (contentState) contentState.style.display = 'flex';

    const avg = (key) => {
        const vals = myRows.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    const tiles = [
        { label: 'Reliable', val: avg('RELIABLE') },
        { label: 'Personable', val: avg('PERSONABLE') },
        { label: 'Fast', val: avg('FAST') },
        { label: 'Safe & Secure', val: avg('SAFE & SECURE') },
        { label: 'Overall Score', val: avg('OVERALL SCORE') }
    ];
    
    const scorecard = document.getElementById('agentScorecard');
    if (scorecard) {
        scorecard.innerHTML = tiles.map(t =>
            `<div class="score-tile"><div class="num">${t.val === null ? '-' : t.val + '%'}</div><div class="lbl">${t.label}</div></div>`
        ).join('');
    }

    const sorted = [...myRows].sort((a, b) => String(b['WEEKENDING'] || '').localeCompare(String(a['WEEKENDING'] || '')));

    const auditRowHtml = (r) => {
        const issues = getRowIssues(r);
        const score = r['OVERALL SCORE'];
        const passed = r['OVERALL PASSRATE'] ? r['OVERALL PASSRATE'] === 'PASSED' : (score !== null && score >= 85);
        const tagsHtml = issues.length
            ? issues.map(i => `<span class="tag ${i.category.replace(/\s|&/g, '')}">${escapeHtml(i.label)}</span>`).join('')
            : `<span class="no-issues-note">✓ No parameters flagged on this audit.</span>`;

        const comments = ['RELIABLE: ADDITIONAL COMMENTS', 'PERSONABLE: ADDITIONAL COMMENTS', 'FAST: ADDITIONAL COMMENTS']
            .map(f => String(r[f] || '').trim())
            .filter(c => c && !NON_ISSUE_VALUES.has(c.toUpperCase()));
        const commentsHtml = comments.length
            ? `<div class="audit-comments">${comments.map(c => `<p>${escapeHtml(c)}</p>`).join('')}</div>`
            : '';

        return `<div class="audit-row">
            <div class="audit-head">
                <span>${escapeHtml(r['WEEKENDING'])} · ${escapeHtml(r['FORM TYPE'])} · ${escapeHtml(r['BRAND'])}</span>
                <span class="score-pill ${passed ? 'pass-pill' : 'fail-pill'}">${score === null ? '-' : score + '%'}</span>
            </div>
            <div class="audit-meta">Team Leader: ${escapeHtml(r['TEAM LEADER']) || '—'} · Cluster: ${escapeHtml(r['CLUSTER']) || '—'}</div>
            <div>${tagsHtml}</div>
            ${commentsHtml}
        </div>`;
    };

    const groups = {};
    sorted.forEach(r => {
        const m = normVal(r['MONTH']) || 'UNSPECIFIED';
        if (!groups[m]) groups[m] = [];
        groups[m].push(r);
    });

    const orderedMonths = Object.keys(groups).sort((a, b) => {
        const aMax = groups[a].reduce((mx, r) => String(r['WEEKENDING'] || '') > mx ? String(r['WEEKENDING'] || '') : mx, '');
        const bMax = groups[b].reduce((mx, r) => String(r['WEEKENDING'] || '') > mx ? String(r['WEEKENDING'] || '') : mx, '');
        return bMax.localeCompare(aMax);
    });

    const auditList = document.getElementById('agentAuditList');
    if (auditList) {
        auditList.innerHTML = orderedMonths.map((month, idx) => {
            const rows = groups[month];
            const monthAvg = (() => {
                const vals = rows.map(r => r['OVERALL SCORE']).filter(v => v !== null && v !== undefined && !isNaN(v));
                return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            })();
            return `<details class="month-group" ${idx === 0 ? 'open' : ''}>
                <summary class="month-summary">
                    <span>${month} <span class="month-count">(${rows.length} audit${rows.length === 1 ? '' : 's'})</span></span>
                    <span class="month-avg">${monthAvg === null ? '' : 'avg ' + monthAvg + '%'}</span>
                </summary>
                <div class="month-body">${rows.map(auditRowHtml).join('')}</div>
            </details>`;
        }).join('');
    }
}

/* ==========================================================================
   EXPOSE TO WINDOW
   ========================================================================== */
window.switchAuthTab = switchAuthTab;
window.setSignupRole = setSignupRole;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.logout = logout;
window.filterData = filterData;
window.resetFilters = resetFilters;
window.toggleUploadPanel = toggleUploadPanel;
window.handleRosterUpload = handleRosterUpload;
window.handleDataUpload = handleDataUpload;
window.resyncAgentEmails = resyncAgentEmails;

// Initialize layout roles safely
setSignupRole('agent');

/* ==========================================================================
   INITIALIZE DOM WORKSPACE LISTENERS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Intercept login authentication submission interface
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleLogin();
        });
    }

    // Attach Log out interaction
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', logout);
    }

    // Attach Filter management interaction
    const btnResetFilters = document.getElementById('btnResetFilters');
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', resetFilters);
    }
    
    // Attach dynamic filter modification event listeners to your dropdown controls
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterData);
    });
});
