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

const TEAM_LEADER_INVITE_CODE = 'PLDT-TL-2026'; // client-side only — fine for a prototype, replace with a Cloud Function check before real use
const QUALITY_INVITE_CODE = 'PLDT-QA-2026'; // client-side only — same caveat as above

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

/* Replaces the entire auditData collection using predictable IDs (row_0,
   row_1, ...) tracked via a small metadata doc. This skips reading every
   existing document just to find its ID before deleting it — cutting
   Firestore operations per upload by roughly a third compared to
   clearCollection() + batchWriteDocs(). The delete+write cost still scales
   with row count (that's inherent to a full replace), so avoid uploading
   repeatedly while testing — try a small trimmed sample file first. */
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
   Firebase Auth persists the session in the browser by default, so a page
   refresh keeps the user logged in — onAuthStateChanged fires on load.
   ========================================================================== */
let currentSession = null; // { uid, email, role, agentName, agentId }

/* ==========================================================================
   AUTH UI
   ========================================================================== */
function switchAuthTab(which) {
    document.getElementById('tabLogin').classList.toggle('active', which === 'login');
    document.getElementById('tabSignup').classList.toggle('active', which === 'signup');
    document.getElementById('loginPane').style.display = which === 'login' ? 'block' : 'none';
    document.getElementById('signupPane').style.display = which === 'signup' ? 'block' : 'none';
}

let signupRole = 'agent';
function setSignupRole(role) {
    signupRole = role;
    document.getElementById('roleAgentLabel').classList.toggle('checked', role === 'agent');
    document.getElementById('roleTeamLeaderLabel').classList.toggle('checked', role === 'team_leader');
    document.getElementById('roleQualityLabel').classList.toggle('checked', role === 'quality');
    const needsCode = role === 'team_leader' || role === 'quality';
    document.getElementById('supervisorCodeGroup').style.display = needsCode ? 'block' : 'none';
    if (needsCode) {
        document.getElementById('supervisorCodeLabel').textContent = role === 'team_leader' ? 'Team Leader Invite Code' : 'Quality Invite Code';
    }
}

function showAuthMsg(elId, text, ok) {
    const el = document.getElementById(elId);
    el.textContent = text;
    el.className = 'auth-msg ' + (ok ? 'ok' : 'error');
}

/* Guards the auto-firing onAuthStateChanged listener from reacting while
   handleSignup is mid-flight. Creating an account signs the user in
   immediately, which used to fire the listener WHILE handleSignup was still
   checking the roster and writing the profile doc — a race that caused the
   success message to disappear, or the new agent to get logged straight
   into a half-set-up session. Login temporarily sets this too, so it can
   drive enterApp() itself deterministically instead of racing the listener. */
let authFlowInProgress = false;

// Set this once you know PLDT's real agent email domain (e.g. '@pldt.com.ph') to restrict sign-up like SMART does.
// Left empty for now so sign-up isn't blocked before that's confirmed.
const REQUIRED_EMAIL_DOMAIN = '';

async function handleSignup() {
    const email = document.getElementById('signupEmail').value.trim().toLowerCase();
    const pw = document.getElementById('signupPassword').value;
    const pw2 = document.getElementById('signupPassword2').value;

    if (!email || !email.includes('@')) return showAuthMsg('signupMsg', 'Enter a valid work email.', false);
    if (REQUIRED_EMAIL_DOMAIN && !email.endsWith(REQUIRED_EMAIL_DOMAIN)) return showAuthMsg('signupMsg', `Please sign up using your ${REQUIRED_EMAIL_DOMAIN} work email.`, false);
    if (pw.length < 6) return showAuthMsg('signupMsg', 'Password must be at least 6 characters.', false);
    if (pw !== pw2) return showAuthMsg('signupMsg', 'Passwords do not match.', false);

    authFlowInProgress = true;
    try {
        if (signupRole === 'team_leader' || signupRole === 'quality') {
            const requiredCode = signupRole === 'team_leader' ? TEAM_LEADER_INVITE_CODE : QUALITY_INVITE_CODE;
            const code = document.getElementById('supervisorCode').value.trim();
            if (code !== requiredCode) return showAuthMsg('signupMsg', 'Invalid invite code.', false);

            let cred;
            try {
                cred = await createUserWithEmailAndPassword(auth, email, pw);
            } catch (err) {
                return showAuthMsg('signupMsg', friendlyAuthError(err), false);
            }
            await setDoc(doc(db, 'users', cred.user.uid), { email, role: signupRole });
            await signOut(auth);
            showAuthMsg('signupMsg', `${signupRole === 'team_leader' ? 'Team Leader' : 'Quality'} account created. You can log in now.`, true);
            clearSignupForm();
            setTimeout(() => switchAuthTab('login'), 1200);
            return;
        }

        // Agent path — account is created first (Firestore rules require being
        // signed in to read the roster), then rolled back if there's no match.
        let cred;
        try {
            cred = await createUserWithEmailAndPassword(auth, email, pw);
        } catch (err) {
            return showAuthMsg('signupMsg', friendlyAuthError(err), false);
        }

        try {
            const rosterSnap = await getDoc(doc(db, 'roster', email));
            if (!rosterSnap.exists()) {
                await deleteUser(cred.user);
                return showAuthMsg('signupMsg', 'This email was not found on the agent roster. Ask your supervisor to add you, then try again.', false);
            }
            const match = rosterSnap.data();

            await setDoc(doc(db, 'users', cred.user.uid), {
                email,
                role: 'agent',
                agentName: match.agentName,
                agentId: match.agentId || ''
            });
            await signOut(auth);
            showAuthMsg('signupMsg', `Account created and matched to "${match.agentName}". You can log in now.`, true);
            clearSignupForm();
            setTimeout(() => switchAuthTab('login'), 1200);
        } catch (err) {
            // best-effort cleanup so a failed signup doesn't leave an orphaned auth account
            try { await deleteUser(cred.user); } catch (e2) {}
            showAuthMsg('signupMsg', friendlyAuthError(err), false);
        }
    } finally {
        authFlowInProgress = false;
    }
}

function clearSignupForm() {
    document.getElementById('signupEmail').value = '';
    document.getElementById('signupPassword').value = '';
    document.getElementById('signupPassword2').value = '';
    const codeEl = document.getElementById('supervisorCode');
    if (codeEl) codeEl.value = '';
}

/* ==========================================================================
   TEMPORARY QUICK ACCESS
   Creates (first time) or logs into real Firebase Auth accounts behind fixed
   credentials — this is a convenience shortcut, not a security bypass.
   Firestore rules are still fully enforced since these are genuine
   authenticated sessions. Remove this block once real sign-ups are in use.
   ========================================================================== */
const QUICK_ACCESS_ACCOUNTS = {
    team_leader: { email: 'tl.quickaccess@pldtqamanagement.com', password: 'PLDT-Quick-2026!' },
    quality: { email: 'qa.quickaccess@pldtqamanagement.com', password: 'PLDT-Quick-2026!' }
};

async function quickAccess(role) {
    const { email, password } = QUICK_ACCESS_ACCOUNTS[role];
    authFlowInProgress = true;
    try {
        let cred;
        try {
            cred = await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                cred = await createUserWithEmailAndPassword(auth, email, password);
                await setDoc(doc(db, 'users', cred.user.uid), { email, role });
            } else {
                throw err;
            }
        }
        let profileSnap = await getDoc(doc(db, 'users', cred.user.uid));
        if (!profileSnap.exists()) {
            await setDoc(doc(db, 'users', cred.user.uid), { email, role });
            profileSnap = await getDoc(doc(db, 'users', cred.user.uid));
        }
        currentSession = { uid: cred.user.uid, ...profileSnap.data() };
        await enterApp();
    } catch (err) {
        showAuthMsg('loginMsg', friendlyAuthError(err), false);
    } finally {
        authFlowInProgress = false;
    }
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pw = document.getElementById('loginPassword').value;
    if (!email || !pw) return showAuthMsg('loginMsg', 'Enter your email and password.', false);

    authFlowInProgress = true;
    try {
        const cred = await signInWithEmailAndPassword(auth, email, pw);
        const profileSnap = await getDoc(doc(db, 'users', cred.user.uid));
        if (!profileSnap.exists()) {
            await signOut(auth);
            return showAuthMsg('loginMsg', 'No profile found for this account. Contact your supervisor.', false);
        }
        currentSession = { uid: cred.user.uid, ...profileSnap.data() };
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
        await enterApp();
    } catch (err) {
        showAuthMsg('loginMsg', friendlyAuthError(err), false);
    } finally {
        authFlowInProgress = false;
    }
}

function logout() {
    signOut(auth); // onAuthStateChanged below handles the UI reset
}

function friendlyAuthError(err) {
    const code = err && err.code ? err.code : '';
    if (code.includes('email-already-in-use')) return 'An account with this email already exists. Try logging in.';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Incorrect email or password.';
    if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (code.includes('invalid-email')) return 'Enter a valid email address.';
    return 'Something went wrong: ' + (err && err.message ? err.message : 'please try again.');
}

/* Resets every piece of UI/state that could otherwise leak between two
   different people using the same browser/station one after another. */
function resetToLoggedOutState() {
    currentSession = null;
    cachedAuditRows = [];
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginMsg').className = 'auth-msg';
    clearSignupForm();
    switchAuthTab('login');

    // clear anything the previous person's session had rendered
    document.getElementById('agentAuditList').innerHTML = '';
    document.getElementById('agentScorecard').innerHTML = '';
    document.getElementById('agentWelcomeName').textContent = 'Welcome';
    document.getElementById('rosterStatus').textContent = 'No roster loaded yet.';
    document.getElementById('dataStatus').textContent = 'No audit data loaded yet.';
    document.getElementById('resyncStatus').textContent = 'Use this if agents uploaded/updated after data was already loaded, or if an agent can\u2019t see rows that should be theirs.';
    document.getElementById('uploadPopover').style.display = 'none';
}

/* Fires on page load (if a session persisted) and after every sign-in/out —
   except while handleSignup/handleLogin are already driving the UI
   themselves (see authFlowInProgress above). */
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
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'flex';

    const roleLabels = { quality: '👤 Quality · ', team_leader: '👤 Team Leader · ', supervisor: '👤 Quality · ', agent: '👤 Agent · ' };
    document.getElementById('sessionLabel').textContent = (roleLabels[currentSession.role] || '👤 ') + currentSession.email;

    // 'supervisor' kept as a legacy alias for 'quality' (full access) in case any older accounts still have that role
    const canViewDashboard = currentSession.role === 'quality' || currentSession.role === 'team_leader' || currentSession.role === 'supervisor';
    const canUpload = currentSession.role === 'quality' || currentSession.role === 'supervisor';

    document.getElementById('supervisorSidebar').style.display = canViewDashboard ? 'flex' : 'none';
    document.getElementById('supervisorView').style.display = canViewDashboard ? 'flex' : 'none';
    document.getElementById('agentView').style.display = canViewDashboard ? 'none' : 'flex';
    document.getElementById('uploadIconBtn').style.display = canUpload ? 'flex' : 'none';

    if (canViewDashboard) {
        if (canUpload) await refreshRosterStatus();
        const rows = await loadAllAuditData();
        if (rows.length) {
            if (canUpload) document.getElementById('dataStatus').innerHTML = `✅ ${rows.length} audit rows loaded.`;
            populateDropdownOptions(rows);
            filterData();
        }
    } else {
        await renderAgentView();
    }
}

/* ==========================================================================
   HIT-PARAMETER CONFIG
   Maps raw audit columns to plain-language "what was flagged" descriptions.
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

/* Forgiving name comparison for matching roster entries to raw-data rows. */
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
   FILE PARSING (SheetJS handles both CSV and XLSX)
   ========================================================================== */
function parseWorkbookFile(file, preferSheetKeywords = []) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                let sheetName = wb.SheetNames[0];

                if (preferSheetKeywords && preferSheetKeywords.length > 0) {
                    const keywords = Array.isArray(preferSheetKeywords) ? preferSheetKeywords : [preferSheetKeywords];
                    const found = wb.SheetNames.find(n => 
                        keywords.some(kw => n.toUpperCase().includes(kw.toUpperCase()))
                    );
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
    if (!row) return null;
    const keys = Object.keys(row);
    
    // Strict exact match
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase() === cand.trim().toLowerCase());
        if (hit) return hit;
    }
    // Partial substring match
    for (const cand of candidates) {
        const hit = keys.find(k => k.trim().toLowerCase().includes(cand.trim().toLowerCase()));
        if (hit) return hit;
    }
    return null;
}

/* ==========================================================================
   ROSTER UPLOAD (Supervisor)
   ========================================================================== */
async function handleRosterUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('rosterStatus').textContent = 'Processing ' + file.name + '...';

    try {
        // Look for sheets named 'ROSTER', 'DOMAIN', 'MASTER', or default to sheet 1
        const rows = await parseWorkbookFile(file, ['ROSTER', 'DOMAIN', 'MASTER']);
        if (!rows.length) throw new Error('empty');

        const emailKey = findHeader(rows[0], [
            'PLDT/SMART Domain v2', 'PLDT/SMART Domain', 'Domain', 'Email', 
            'Work Email', 'Conduent Email Address', 'Email Address', 'PLDT Domain'
        ]);
        const nameKey = findHeader(rows[0], [
            'Employee Name', 'Agent Name', 'AGENT/OFFICER NAME', 'Name', 'Full Name'
        ]);
        const idKey = findHeader(rows[0], [
            'Win ID', 'WIN ID', 'Win id', 'ID', 'Employee ID', 'EE number/ID number', 'Agent ID', 'Badge Number'
        ]);

        if (!emailKey || !nameKey) {
            console.warn('Roster column detection failed. Email column found:', emailKey, '| Name column found:', nameKey);
            console.log('Actual column headers in parsed sheet:', JSON.stringify(Object.keys(rows[0])));
            throw new Error('missing columns');
        }

        const roster = rows
            .map(r => ({
                email: String(r[emailKey] || '').trim().toLowerCase(),
                agentName: String(r[nameKey] || '').trim(),
                agentId: idKey ? String(r[idKey] || '').trim() : ''
            }))
            .filter(r => r.email && r.agentName);

        await clearCollection('roster');
        await batchWriteDocs('roster', roster, (r) => r.email);

        document.getElementById('rosterStatus').innerHTML = `✅ Roster loaded: ${roster.length} agents matched to emails.`;
    } catch (err) {
        console.error(err);
        document.getElementById('rosterStatus').innerHTML =
            `⚠️ Could not read roster — check browser console (F12) for details.`;
    }
}

async function refreshRosterStatus() {
    const snap = await getDocs(collection(db, 'roster'));
    if (snap.size) {
        document.getElementById('rosterStatus').innerHTML = `✅ Roster loaded: ${snap.size} agents.`;
    }
}

async function resyncAgentEmails() {
    const statusEl = document.getElementById('resyncStatus');
    statusEl.textContent = 'Re-syncing...';

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

        let msg = `✅ Re-synced: ${matched} rows matched to a roster email, ${unmatched} rows still unmatched (${unmatchedNames.size} distinct agent name(s)).`;
        if (unmatchedNames.size) {
            const list = [...unmatchedNames];
            msg += ` First few: ${list.slice(0, 6).join(' | ')}${list.length > 6 ? ' …' : ''} — full list logged to console.`;
            console.warn('Unmatched agent names (not found on roster):', list);
        }
        statusEl.textContent = msg;
    } catch (err) {
        console.error(err);
        statusEl.textContent = '⚠️ Re-sync failed: ' + (err && err.message ? err.message : 'unknown error');
    }
}

/* ==========================================================================
   RAW AUDIT DATA UPLOAD (Supervisor)
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
    document.getElementById('dataStatus').textContent = 'Processing ' + file.name + '...';

    try {
        const rows = await parseWorkbookFile(file, ['RAW', 'DATA']);
        if (!rows.length) throw new Error('empty');

        const headerMap = {};
        NEEDED_FIELDS.forEach(f => {
            const h = findHeader(rows[0], [f]);
            if (h) headerMap[f] = h;
        });

        const missingFields = NEEDED_FIELDS.filter(f => !headerMap[f]);
        if (missingFields.length) {
            console.warn('Columns not found in uploaded file:', missingFields);
            console.log('Actual column headers in uploaded file:', JSON.stringify(Object.keys(rows[0])));
        }

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
        const dupCount = trimmed.length - deduped.length;

        await replaceAuditData(deduped);

        cachedAuditRows = deduped;
        let msg = `✅ ${deduped.length} audit rows loaded${dupCount ? ` (${dupCount} exact duplicate row${dupCount === 1 ? '' : 's'} removed)` : ''}.`;
        if (missingFields.length) {
            msg += ` ⚠️ ${missingFields.length} expected column(s) missing — check console for details.`;
        }
        document.getElementById('dataStatus').innerHTML = msg;
        populateDropdownOptions(trimmed);
        filterData();
    } catch (err) {
        console.error(err);
        document.getElementById('dataStatus').innerHTML = `⚠️ Could not read file. Check expected audit columns.`;
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
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function resetFilters() {
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader']
        .forEach(id => { document.getElementById(id).value = 'ALL'; });
    filterData();
}

function filterData() {
    const rows = cachedAuditRows;
    if (!rows.length) return;

    const f = {
        formType: document.getElementById('selectFormType').value,
        brand: document.getElementById('selectBrand').value,
        month: document.getElementById('selectMonth').value,
        weekending: document.getElementById('selectWeekending').value,
        tenure: document.getElementById('selectTenure').value,
        teamLeader: document.getElementById('selectTeamLeader').value
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
    if (!data.length) {
        document.getElementById('totalPassRateVal').textContent = '-';
        document.getElementById('totalFailRateVal').textContent = '-';
        document.getElementById('cmSuperstarVal').textContent = '-';
        document.getElementById('cmUnderperformerVal').textContent = '-';
        document.getElementById('leaderChart').innerHTML = '<div class="empty-note">No matching data.</div>';
        document.getElementById('parameterChart').innerHTML = '<div class="empty-note">No matching data.</div>';
        document.getElementById('topHitsTable').querySelector('tbody').innerHTML = '<tr><td colspan="3" class="empty-note">No matching data.</td></tr>';
        document.getElementById('clusterDistTable').querySelector('tbody').innerHTML = '<tr><td colspan="7" class="empty-note">No matching data.</td></tr>';
        return;
    }

    const avg = (key) => {
        const vals = data.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
        if (!vals.length) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const avgOverall = avg('OVERALL SCORE');

    // Calculated Scores per Line of Business (LOB)
    const lobScores = {};
    data.forEach(r => {
        const lob = r['LINE OF BUSINESS'] || 'Unspecified LOB';
        if (!lobScores[lob]) lobScores[lob] = { total: 0, count: 0 };
        if (r['OVERALL SCORE'] !== null && r['OVERALL SCORE'] !== undefined) {
            lobScores[lob].total += r['OVERALL SCORE'];
            lobScores[lob].count++;
        }
    });

    const lobColors = ['#C8102E', '#7a0f1e', '#1a1a1a', '#6b6b6b', '#f0c4c9', '#d9534f', '#0275d8'];
    const parameterChart = document.getElementById('parameterChart');
    const lobNames = Object.keys(lobScores).sort();
    parameterChart.innerHTML = lobNames.length
        ? lobNames.map((lob, i) => {
            const s = lobScores[lob];
            const a = s.count ? Math.round(s.total / s.count) : 0;
            return `<div class="bar-wrapper">
                <div class="bar-value">${a}%</div>
                <div class="bar" style="background:${lobColors[i % lobColors.length]};height:${a}%;"></div>
                <div class="bar-label">${escapeHtml(lob)}</div>
            </div>`;
        }).join('')
        : '<div class="empty-note">No matching data.</div>';

    const isPassed = (r) => r['OVERALL PASSRATE'] ? r['OVERALL PASSRATE'] === 'PASSED' : (r['OVERALL SCORE'] || 0) >= 85;
    const passed = data.filter(isPassed).length;
    const passPct = Math.round((passed / data.length) * 100);
    document.getElementById('totalPassRateVal').textContent = passPct + '%';
    document.getElementById('totalFailRateVal').textContent = (100 - passPct) + '%';

    const buckets = { b1: [], b2: [], b3: [] };
    data.forEach(r => buckets[tenureBucket(r['AGENT TENURE'])].push(r));
    const bucketAvg = (arr) => {
        const vals = arr.map(r => r['OVERALL SCORE']).filter(v => v !== null && v !== undefined && !isNaN(v));
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '-';
    };
    document.getElementById('totalAuditNhip').textContent = buckets.b1.length || '-';
    document.getElementById('totalAudit31').textContent = buckets.b2.length || '-';
    document.getElementById('totalAudit91').textContent = buckets.b3.length || '-';
    document.getElementById('totalAuditTotal').textContent = data.length;
    document.getElementById('totalAvgNhip').textContent = bucketAvg(buckets.b1);
    document.getElementById('totalAvg31').textContent = bucketAvg(buckets.b2);
    document.getElementById('totalAvg91').textContent = bucketAvg(buckets.b3);
    document.getElementById('totalAvgTotal').textContent = avgOverall === null ? '-' : avgOverall + '%';

    const cmRows = data.filter(r => r['CM']);
    if (cmRows.length) {
        const superstar = cmRows.filter(r => r['CM'] === 'SUPERSTAR').length;
        document.getElementById('cmSuperstarVal').textContent = Math.round((superstar / cmRows.length) * 100) + '%';
        document.getElementById('cmUnderperformerVal').textContent = Math.round(((cmRows.length - superstar) / cmRows.length) * 100) + '%';
    } else {
        document.getElementById('cmSuperstarVal').textContent = '-';
        document.getElementById('cmUnderperformerVal').textContent = '-';
    }

    const tlScores = {};
    data.forEach(r => {
        const tl = r['TEAM LEADER'] || 'Unassigned';
        if (!tlScores[tl]) tlScores[tl] = { total: 0, count: 0 };
        if (r['OVERALL SCORE'] !== null) { tlScores[tl].total += r['OVERALL SCORE']; tlScores[tl].count++; }
    });
    const leaderChart = document.getElementById('leaderChart');
    leaderChart.innerHTML = Object.entries(tlScores).map(([tl, s]) => {
        const a = s.count ? Math.round(s.total / s.count) : 0;
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label" title="${tl}">${tl}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${a}%;">${a}%</div></div>
        </div>`;
    }).join('') || '<div class="empty-note">No matching data.</div>';

    const hitCounts = {};
    data.forEach(r => {
        getRowIssues(r).forEach(issue => {
            const key = issue.label + '||' + issue.category;
            hitCounts[key] = (hitCounts[key] || 0) + 1;
        });
    });
    const sortedHits = Object.entries(hitCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const tbody = document.getElementById('topHitsTable').querySelector('tbody');
    tbody.innerHTML = sortedHits.length
        ? sortedHits.map(([key, count]) => {
            const [label, category] = key.split('||');
            return `<tr><td style="text-align:left;">${label}</td><td>${category}</td><td>${count}</td></tr>`;
        }).join('')
        : '<tr><td colspan="3" class="empty-note">No parameters flagged in this selection.</td></tr>';

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

    const clusterDistBody = document.getElementById('clusterDistTable').querySelector('tbody');
    const clusterNames = Object.keys(clusterRows).sort();
    clusterDistBody.innerHTML = clusterNames.length
        ? clusterNames.map(c => {
            const scores = clusterRows[c];
            const total = scores.length;
            const pctCells = distBuckets.map(b => {
                const count = scores.filter(b.test).length;
                const pct = total ? Math.round((count / total) * 100) : 0;
                return `<td>${pct}%</td>`;
            }).join('');
            return `<tr><td style="font-weight:bold;">${c}</td>${pctCells}<td>${total}</td></tr>`;
        }).join('')
        : '<tr><td colspan="7" class="empty-note">No matching data.</td></tr>';
}

/* ==========================================================================
   AGENT VIEW
   ========================================================================== */
async function renderAgentView() {
    document.getElementById('agentWelcomeName').textContent = 'Welcome, ' + (currentSession.agentName || currentSession.email);

    const q = query(collection(db, 'auditData'), where('agentEmailLower', '==', currentSession.email));
    const snap = await getDocs(q);
    const myRows = snap.docs.map(d => d.data());

    if (!myRows.length) {
        document.getElementById('agentEmptyState').style.display = 'block';
        document.getElementById('agentContent').style.display = 'none';
        return;
    }

    document.getElementById('agentEmptyState').style.display = 'none';
    document.getElementById('agentContent').style.display = 'flex';

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
    document.getElementById('agentScorecard').innerHTML = tiles.map(t =>
        `<div class="score-tile"><div class="num">${t.val === null ? '-' : t.val + '%'}</div><div class="lbl">${t.label}</div></div>`
    ).join('');

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
                <span>${escapeHtml(r['WEEKENDING'])} · ${escapeHtml(r['FORM TYPE'])} · ${escapeHtml(r['LINE OF BUSINESS'] || r['BRAND'])}</span>
                <span class="score-pill ${passed ? 'pass-pill' : 'fail-pill'}">${score === null ? '-' : score + '%'}</span>
            </div>
            <div class="audit-meta">Team Leader: ${escapeHtml(r['TEAM LEADER']) || '—'} · Cluster: ${escapeHtml(r['CLUSTER']) || '—'} · Month: ${escapeHtml(r['MONTH']) || '—'}</div>
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

    document.getElementById('agentAuditList').innerHTML = orderedMonths.map((month, idx) => {
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

/* ==========================================================================
   DYNAMIC DOM CLEANUP
   ========================================================================== */
function removePrototypeBanner() {
    const allEls = document.querySelectorAll('div, p, header, section, span, banner');
    allEls.forEach(el => {
        if (el.textContent && el.textContent.includes('Prototype build') && el.textContent.includes('customer PII')) {
            el.remove();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removePrototypeBanner);
} else {
    removePrototypeBanner();
}

/* ==========================================================================
   EXPOSE TO WINDOW
   ========================================================================== */
window.switchAuthTab = switchAuthTab;
window.setSignupRole = setSignupRole;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.quickAccess = quickAccess;
window.logout = logout;
window.filterData = filterData;
window.resetFilters = resetFilters;
window.toggleUploadPanel = toggleUploadPanel;
window.handleRosterUpload = handleRosterUpload;
window.handleDataUpload = handleDataUpload;
window.resyncAgentEmails = resyncAgentEmails;

/* ==========================================================================
   INIT
   ========================================================================== */
setSignupRole('agent');
