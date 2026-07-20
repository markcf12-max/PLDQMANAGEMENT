// ==========================================
// 1. FIREBASE INITIALIZATION & EXPORTS
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwEhTcIAJkwLoLCUh4eqEY20KsbenmXrQ",
  authDomain: "pldtqamanagement.firebaseapp.com",
  projectId: "pldtqamanagement",
  storageBucket: "pldtqamanagement.firebasestorage.app",
  messagingSenderId: "935852786747",
  appId: "1:935852786747:web:08fd0e98362aceb805081e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ==========================================
// 2. DOM ELEMENTS & LOCAL STATE DATA
// ==========================================
const loginForm = document.getElementById('loginForm');
const authMessage = document.getElementById('authMessage');
const auditForm = document.getElementById('auditForm');
const qaParametersInputs = document.getElementById('qaParametersInputs');
const qaLiveFeedTableBody = document.querySelector('#qaLiveFeedTable tbody');

// Hardcoded Master Credentials Directory
const enterpriseRoster = {
    "agent@pldt.com": { password: "pldt123", role: "agent", name: "Agent Workspace" },
    "tl@pldt.com": { password: "pldt123", role: "team_leader", name: "Team Leader Dashboard" },
    "qa@pldt.com": { password: "pldt123", role: "quality", name: "QA Management Terminal" }
};

// Hardcoded Evaluation Parameters Configuration Matrix
const complianceMetrics = [
    { id: "reliable", name: "Reliable & Stable System Connects", category: "Reliable" },
    { id: "personable", name: "Empathy & Personable Greetings", category: "Personable" },
    { id: "fast", name: "Efficient & Fast Case Resolution Time", category: "Fast" },
    { id: "secure", name: "Safe & Secure Identity Verification", category: "Safe & Secure" }
];

// Memory Data Matrix to capture runtime evaluation feeds dynamically
let transactionalEvaluations = [];

// ==========================================
// 3. HARDCODED AUTHENTICATION CORE
// ==========================================
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const selectedRole = document.querySelector('input[name="authRole"]:checked').value;
    
    authMessage.textContent = ""; 

    if (enterpriseRoster[email]) {
        const account = enterpriseRoster[email];
        
        if (account.password === password && account.role === selectedRole) {
            showWorkspace(selectedRole, account.name);
        } else if (account.password !== password) {
            authMessage.className = "auth-msg error";
            authMessage.textContent = "Invalid enterprise password parameter credentials.";
        } else {
            authMessage.className = "auth-msg error";
            authMessage.textContent = `Access Denied: Account lacks authority for '${selectedRole}'.`;
        }
    } else {
        authMessage.className = "auth-msg error";
        authMessage.textContent = "User profile record target index identifier not found.";
    }
});

function showWorkspace(role, userDisplayName) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
    
    const sessionChip = document.getElementById('sessionChip');
    const sessionLabel = document.getElementById('sessionLabel');
    if(sessionChip && sessionLabel) {
        sessionChip.style.display = 'inline-flex';
        sessionLabel.textContent = `${userDisplayName} (${role.toUpperCase()})`;
    }

    // Toggle Workspace Views
    if (role === 'team_leader') {
        document.getElementById('supervisorView').style.display = 'block';
        document.getElementById('appSidebar').style.display = 'block';
        renderSupervisorDashboard();
    } else if (role === 'quality') {
        document.getElementById('qualityView').style.display = 'block';
        initializeQAParametersForm();
    } else {
        document.getElementById('agentView').style.display = 'block';
        renderAgentWorkspaceView();
    }
}

document.getElementById('btnLogout').addEventListener('click', () => {
    location.reload();
});

// ==========================================
// 4. QUALITY ASSURANCE MANAGEMENT CONSOLE
// ==========================================
function initializeQAParametersForm() {
    if (!qaParametersInputs) return;
    qaParametersInputs.innerHTML = "";
    
    complianceMetrics.forEach(metric => {
        const itemRow = document.createElement('div');
        itemRow.style.display = 'flex';
        itemRow.style.justifyContent = 'space-between';
        itemRow.style.alignItems = 'center';
        
        itemRow.innerHTML = `
            <label for="param_${metric.id}" style="font-size:12px; max-width:70%;">${metric.name}</label>
            <select id="param_${metric.id}" class="param-score-input" data-category="${metric.category}" style="padding: 2px 6px; font-size:12px;">
                <option value="100">Pass (100)</option>
                <option value="0">Fail (0)</option>
            </select>
        `;
        qaParametersInputs.appendChild(itemRow);
    });
}

if (auditForm) {
    auditForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Calculate dynamic parameter values
        const inputs = document.querySelectorAll('.param-score-input');
        let totalScore = 0;
        let parametersMapped = {};
        
        inputs.forEach(input => {
            const score = parseInt(input.value);
            totalScore += score;
            const paramId = input.id.replace('param_', '');
            parametersMapped[paramId] = score;
        });
        
        const overallScore = Math.round(totalScore / inputs.length);
        const passStatus = overallScore >= 80 ? "PASSED" : "FAILED";

        const newEvaluation = {
            agent: document.getElementById('auditAgent').value,
            eeid: document.getElementById('auditEEID').value,
            formType: document.getElementById('auditFormType').value,
            brand: document.getElementById('auditBrand').value,
            teamLeader: document.getElementById('auditTL').value,
            cluster: document.getElementById('auditCluster').value.toUpperCase(),
            weekending: document.getElementById('auditWeek').value,
            month: document.getElementById('auditMonth').value,
            tenure: document.getElementById('auditTenure').value,
            score: overallScore,
            status: passStatus,
            breakdown: parametersMapped,
            comments: document.getElementById('auditComments').value || "N/A"
        };

        transactionalEvaluations.push(newEvaluation);
        updateLivePipelineFeed();
        auditForm.reset();
        alert("Transaction record captured and committed to local cache matrix!");
    });
}

function updateLivePipelineFeed() {
    if (!qaLiveFeedTableBody) return;
    qaLiveFeedTableBody.innerHTML = "";
    
    if (transactionalEvaluations.length === 0) {
        qaLiveFeedTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#999;">No historical transactional matrix pipelines loaded.</td></tr>`;
        return;
    }

    transactionalEvaluations.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${item.agent}</strong> <span style="font-size:10px; color:#777;">(${item.eeid})</span></td>
            <td>${item.formType}</td>
            <td>${item.weekending}</td>
            <td style="font-weight:bold; color: ${item.score >= 80 ? '#2e7d32' : '#c8102e'};">${item.score}%</td>
            <td><span class="badge" style="background:${item.status === 'PASSED' ? '#e8f5e9;color:#2e7d32' : '#ffebee;color:#c8102e'}; padding:2px 6px; font-size:11px; border-radius:4px; font-weight:bold;">${item.status}</span></td>
        `;
        qaLiveFeedTableBody.appendChild(row);
    });
}

// ==========================================
// 5. SUPERVISOR & AGENT RUNTIME COMPILATION
// ==========================================
function renderSupervisorDashboard() {
    if(transactionalEvaluations.length === 0) return;
    
    let totalPass = 0, totalFail = 0;
    let reliableSum = 0, personableSum = 0, fastSum = 0, secureSum = 0;

    transactionalEvaluations.forEach(ev => {
        if (ev.status === "PASSED") totalPass++; else totalFail++;
        reliableSum += ev.breakdown.reliable;
        personableSum += ev.breakdown.personable;
        fastSum += ev.breakdown.fast;
        secureSum += ev.breakdown.secure;
    });

    const totalAudits = transactionalEvaluations.length;
    
    // Update structural DOM value matrices
    document.getElementById('totalPassRateVal').textContent = `${Math.round((totalPass / totalAudits) * 100)}%`;
    document.getElementById('totalFailRateVal').textContent = `${Math.round((totalFail / totalAudits) * 100)}%`;
    
    // Process parameter tracking visualization meters
    const reliableAvg = Math.round(reliableSum / totalAudits);
    const personableAvg = Math.round(personableSum / totalAudits);
    const fastAvg = Math.round(fastSum / totalAudits);
    const secureAvg = Math.round(secureSum / totalAudits);
    const overallAvg = Math.round((reliableAvg + personableAvg + fastAvg + secureAvg) / 4);

    updateVisualBarChart('Reliable', reliableAvg);
    updateVisualBarChart('Personable', personableAvg);
    updateVisualBarChart('Fast', fastAvg);
    updateVisualBarChart('Secure', secureAvg);
    updateVisualBarChart('Overall', overallAvg);
}

function updateVisualBarChart(idName, score) {
    const barEl = document.getElementById(`bar${idName}`);
    const valEl = document.getElementById(`val${idName}`);
    if (barEl && valEl) {
        barEl.style.height = `${score}%`;
        valEl.textContent = `${score}%`;
    }
}

function renderAgentWorkspaceView() {
    const agentEmptyState = document.getElementById('agentEmptyState');
    const agentContent = document.getElementById('agentContent');
    const agentAuditList = document.getElementById('agentAuditList');
    
    if(!agentEmptyState || !agentContent || !agentAuditList) return;

    // Filter audits related to standard default demo parameters
    const myAudits = transactionalEvaluations.filter(e => e.eeid === "52501234" || e.agent.toLowerCase().includes('agent'));

    if(myAudits.length === 0) {
        agentEmptyState.style.display = "block";
        agentContent.style.display = "none";
    } else {
        agentEmptyState.style.display = "none";
        agentContent.style.display = "flex";
        agentAuditList.innerHTML = myAudits.map(audit => `
            <div style="background:#f9f9f9; padding:12px; border-left:4px solid ${audit.status === 'PASSED' ? '#2e7d32' : '#c8102e'}; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-weight:bold;">
                    <span>Form Type: ${audit.formType} (${audit.weekending})</span>
                    <span style="color:${audit.status === 'PASSED' ? '#2e7d32' : '#c8102e'};">${audit.score}%</span>
                </div>
                <p style="margin:4px 0 0 0; font-size:12px; color:#555;">Comments: ${audit.comments}</p>
            </div>
        `).join('');
    }
}
