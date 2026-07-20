/* ==========================================================================
   PLDT QUALITY SCORE DASHBOARD — RUNTIME BUILD
   ========================================================================== */

let currentSession = null; 
let cachedAuditRows = [];

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
   STANDALONE DATA GENERATION ENGINE
   ========================================================================== */
const PLDT_AGENTS = [
    { name: 'Dela Cruz, Juan', tenure: '>91 DAYS' },
    { name: 'Santos, Maria', tenure: '>91 DAYS' },
    { name: 'Reyes, Aldrin', tenure: '31-90 DAYS' },
    { name: 'Bautista, Elisa', tenure: '0-30 DAYS' },
    { name: 'Aquino, Paolo', tenure: '>91 DAYS' },
    { name: 'Alvarez, Glenn', tenure: '31-90 DAYS' }
];
const PLDT_TLS = ['TL Cruz, Jennifer', TL_Pascual_Marvin = 'TL Pascual, Marvin', 'TL Soriano, Rachel'];
const PLDT_CLUSTERS = ['Cluster Alpha', 'Cluster Beta', 'Cluster Gamma'];
const PLDT_BRANDS = ['PLDT Home DSL/Fibr', 'PLDT Enterprise Voice', 'PLDT Mobile Data'];
const PLDT_FORM_TYPES = ['Voice Call Form', 'Digital Chat Form'];
const PLDT_WEEKS = [
    ['WE0606', 'JUNE'], ['WE0613', 'JUNE'], ['WE0620', 'JUNE'], ['WE0627', 'JUNE'],
    ['WE0704', 'JULY'], ['WE0711', 'JULY'], ['WE0718', 'JULY']
];
const PLDT_MOCK_COMMENTS = [
    'Agent missed validation procedures before proceeding with service reconfiguration.',
    'Clear and empathetic delivery; structured pacing maintained during outage discussion.',
    'System tagging missed on the primary customer account tool workspace.',
    'Follow up ticket generated incorrectly under billing instead of technical dispatch.'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateMockDataset() {
    const rows = [];
    let counter = 1;

    PLDT_AGENTS.forEach(agent => {
        const totalAudits = randInt(4, 8);
        const shuffledWeeks = [...PLDT_WEEKS].sort(() => Math.random() - 0.5).slice(0, totalAudits);

        shuffledWeeks.forEach(([weekending, month]) => {
            const scoreRoll = Math.random();
            const overallScore = scoreRoll < 0.70 ? randInt(88, 100) : scoreRoll < 0.90 ? randInt(75, 87) : randInt(50, 74);
            const deviation = () => Math.max(0, Math.min(100, overallScore + randInt(-5, 5)));

            const row = {
                'ID': 'ROW_' + counter++,
                'FORM TYPE': pick(PLDT_FORM_TYPES),
                'BRAND': pick(PLDT_BRANDS),
                'LINE OF BUSINESS': 'Customer Service Tech Support',
                'AGENT/OFFICER NAME': agent.name,
                'AGENT TENURE': agent.tenure,
                'TEAM LEADER': pick(PLDT_TLS),
                'CLUSTER': pick(PLDT_CLUSTERS),
                'WEEKENDING': weekending,
                'MONTH': month,
                'MISTREAT': '100%',
                'RELIABLE': deviation(),
                'PERSONABLE': deviation(),
                'FAST': deviation(),
                'SAFE & SECURE': deviation(),
                'OVERALL SCORE': overallScore,
                'EE number/ID number': String(9004100 + counter),
                'OVERALL PASSRATE': overallScore >= 85 ? 'PASSED' : 'FAILED',
                'CM': overallScore >= 90 ? 'SUPERSTAR' : 'UNDERPERFORMER',
                'RELIABLE: ADDITIONAL COMMENTS': '',
                'PERSONABLE: ADDITIONAL COMMENTS': '',
                'FAST: ADDITIONAL COMMENTS': ''
            };

            HIT_PARAMS.forEach(p => {
                row[p.col] = p.type === 'boolean' ? (p.hitValue === 'NO' ? 'YES' : 'NO') : 'NO OPPORTUNITY';
            });

            if (overallScore < 85) {
                const targets = HIT_PARAMS.sort(() => Math.random() - 0.5).slice(0, randInt(1, 3));
                targets.forEach(p => {
                    row[p.col] = p.type === 'boolean' ? p.hitValue : pick(PLDT_MOCK_COMMENTS);
                });
                row['RELIABLE: ADDITIONAL COMMENTS'] = pick(PLDT_MOCK_COMMENTS);
            }

            rows.push(row);
        });
    });
    return rows;
}

function regenerateMemoryDataset() {
    cachedAuditRows = generateMockDataset();
    filterData();
}

/* ==========================================================================
   NAVIGATION AND ENVIRONMENT LAYOUT CONTROL
   ========================================================================== */
function enterDemo(role) {
    if (role === 'supervisor') {
        currentSession = { role: 'supervisor' };
    } else {
        const agentName = document.getElementById('demoAgentPicker').value;
        currentSession = { role: 'agent', agentName };
    }
    
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'flex';
    
    document.getElementById('sessionLabel').textContent = currentSession.role === 'supervisor' 
        ? '👤 Corporate Supervisor' 
        : `👤 Agent Account: ${currentSession.agentName}`;

    const isSupervisor = currentSession.role === 'supervisor';
    document.getElementById('supervisorSidebar').style.display = isSupervisor ? 'flex' : 'none';
    document.getElementById('supervisorView').style.display = isSupervisor ? 'flex' : 'none';
    document.getElementById('agentView').style.display = isSupervisor ? 'none' : 'flex';

    if (isSupervisor) {
        populateDropdownOptions(cachedAuditRows);
        filterData();
    } else {
        renderAgentView();
    }
}

function logout() {
    currentSession = null;
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'none';
}

function populateDropdownOptions(rows) {
    const selectorMapping = {
        selectFormType: 'FORM TYPE',
        selectBrand: 'BRAND',
        selectMonth: 'MONTH',
        selectWeekending: 'WEEKENDING',
        selectTenure: 'AGENT TENURE',
        selectTeamLeader: 'TEAM LEADER'
    };
    Object.entries(selectorMapping).forEach(([elementId, dataField]) => {
        const element = document.getElementById(elementId);
        const previousSelection = element.value;
        const distinctValues = [...new Set(rows.map(r => r[dataField]).filter(Boolean))].sort();
        element.innerHTML = `<option value="ALL">(All Options)</option>` + distinctValues.map(v => `<option value="${v}">${v}</option>`).join('');
        if (distinctValues.includes(previousSelection)) element.value = previousSelection;
    });
}

function resetFilters() {
    ['selectFormType', 'selectBrand', 'selectMonth', 'selectWeekending', 'selectTenure', 'selectTeamLeader']
        .forEach(id => { document.getElementById(id).value = 'ALL'; });
    filterData();
}

function filterData() {
    const conditions = {
        formType: document.getElementById('selectFormType').value,
        brand: document.getElementById('selectBrand').value,
        month: document.getElementById('selectMonth').value,
        weekending: document.getElementById('selectWeekending').value,
        tenure: document.getElementById('selectTenure').value,
        teamLeader: document.getElementById('selectTeamLeader').value
    };

    const filtered = cachedAuditRows.filter(r =>
        (conditions.formType === 'ALL' || r['FORM TYPE'] === conditions.formType) &&
        (conditions.brand === 'ALL' || r['BRAND'] === conditions.brand) &&
        (conditions.month === 'ALL' || r['MONTH'] === conditions.month) &&
        (conditions.weekending === 'ALL' || r['WEEKENDING'] === conditions.weekending) &&
        (conditions.tenure === 'ALL' || r['AGENT TENURE'] === conditions.tenure) &&
        (conditions.teamLeader === 'ALL' || r['TEAM LEADER'] === conditions.teamLeader)
    );

    renderSupervisorDashboard(filtered);
}

function tenureBucket(tenureStr) {
    const clean = normVal(tenureStr);
    if (clean.includes('0-30')) return 'b1';
    if (clean.includes('31-90') || clean.includes('31-60')) return 'b2';
    return 'b3';
}

/* ==========================================================================
   VISUAL MATRIX MATRIX CALCULATORS
   ========================================================================== */
function renderSupervisorDashboard(data) {
    if (!data.length) {
        document.getElementById('totalPassRateVal').textContent = '-';
        document.getElementById('totalFailRateVal').textContent = '-';
        return;
    }

    const computeAverage = (key) => {
        const subset = data.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
        return subset.length ? Math.round(subset.reduce((a, b) => a + b, 0) / subset.length) : null;
    };

    // Update Core Parameter Bar Charts
    const updateUiBar = (valueElement, barElement, evaluatedScore) => {
        document.getElementById(valueElement).textContent = evaluatedScore === null ? '-' : evaluatedScore + '%';
        document.getElementById(barElement).style.height = (evaluatedScore || 0) + '%';
    };
    updateUiBar('valReliable', 'barReliable', computeAverage('RELIABLE'));
    updateUiBar('valPersonable', 'barPersonable', computeAverage('PERSONABLE'));
    updateUiBar('valFast', 'barFast', computeAverage('FAST'));
    updateUiBar('valSecure', 'barSecure', computeAverage('SAFE & SECURE'));
    updateUiBar('valOverall', 'barOverall', computeAverage('OVERALL SCORE'));

    // Pass Fail Metrics
    const totalPassed = data.filter(r => r['OVERALL PASSRATE'] === 'PASSED').length;
    const computedPassRate = Math.round((totalPassed / data.length) * 100);
    document.getElementById('totalPassRateVal').textContent = computedPassRate + '%';
    document.getElementById('totalFailRateVal').textContent = (100 - computedPassRate) + '%';

    // Tenure Grid Metrics
    const buckets = { b1: [], b2: [], b3: [] };
    data.forEach(r => buckets[tenureBucket(r['AGENT TENURE'])].push(r));
    
    const resolveBucketStats = (arr) => {
        const actualScores = arr.map(r => r['OVERALL SCORE']).filter(v => !isNaN(v) && v !== null);
        return actualScores.length ? Math.round(actualScores.reduce((a, b) => a + b, 0) / actualScores.length) + '%' : '-';
    };

    document.getElementById('totalAuditNhip').textContent = buckets.b1.length;
    document.getElementById('totalAudit31').textContent = buckets.b2.length;
    document.getElementById('totalAudit91').textContent = buckets.b3.length;
    document.getElementById('totalAuditTotal').textContent = data.length;

    document.getElementById('totalAvgNhip').textContent = resolveBucketStats(buckets.b1);
    document.getElementById('totalAvg31').textContent = resolveBucketStats(buckets.b2);
    document.getElementById('totalAvg91').textContent = resolveBucketStats(buckets.b3);
    document.getElementById('totalAvgTotal').textContent = computeAverage('OVERALL SCORE') + '%';

    // CM Assessment Row Calculation Elements
    const superstars = data.filter(r => r['CM'] === 'SUPERSTAR').length;
    document.getElementById('cmSuperstarVal').textContent = Math.round((superstars / data.length) * 100) + '%';
    document.getElementById('cmUnderperformerVal').textContent = Math.round(((data.length - superstars) / data.length) * 100) + '%';

    // Scores Per Team Leader Chart Builder
    const leaderRecords = {};
    data.forEach(r => {
        const leader = r['TEAM LEADER'] || 'Unassigned Leader';
        if (!leaderRecords[leader]) leaderRecords[leader] = { sum: 0, cases: 0 };
        leaderRecords[leader].sum += r['OVERALL SCORE'];
        leaderRecords[leader].cases++;
    });
    document.getElementById('leaderChart').innerHTML = Object.entries(leaderRecords).map(([name, dataObj]) => {
        const scorePct = Math.round(dataObj.sum / dataObj.cases);
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label">${name}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${scorePct}%;">${scorePct}%</div></div>
        </div>`;
    }).join('');

    // Scores Per Operational Cluster Chart Builder
    const clusterRecords = {};
    data.forEach(r => {
        const cluster = r['CLUSTER'] || 'Unassigned Cluster';
        if (!clusterRecords[cluster]) clusterRecords[cluster] = { sum: 0, cases: 0 };
        clusterRecords[cluster].sum += r['OVERALL SCORE'];
        clusterRecords[cluster].cases++;
    });
    document.getElementById('clusterChart').innerHTML = Object.entries(clusterRecords).map(([name, dataObj]) => {
        const scorePct = Math.round(dataObj.sum / dataObj.cases);
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label">${name}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${scorePct}%; background:#1a1a1a;">${scorePct}%</div></div>
        </div>`;
    }).join('');

    // Frequency Analysis Breakdown Counter
    const parameterHits = {};
    data.forEach(r => {
        getRowIssues(r).forEach(issue => {
            const combinedKey = issue.label + '||' + issue.category;
            parameterHits[combinedKey] = (parameterHits[combinedKey] || 0) + 1;
        });
    });
    const rankedParameters = Object.entries(parameterHits).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const hitListBody = document.getElementById('topHitsTable').querySelector('tbody');
    hitListBody.innerHTML = rankedParameters.length 
        ? rankedParameters.map(([combinedKey, count]) => {
            const [label, category] = combinedKey.split('||');
            return `<tr><td>${label}</td><td><span class="tag ${category}">${category}</span></td><td><b>${count}</b> iterations</td></tr>`;
        }).join('')
        : '<tr><td colspan="3" class="empty-note">No structural variances flagged inside current configuration.</td></tr>';
}

function renderAgentView() {
    document.getElementById('agentWelcomeName').textContent = 'Welcome, ' + currentSession.agentName;
    const personalRows = cachedAuditRows.filter(r => r['AGENT/OFFICER NAME'] === currentSession.agentName);

    if (!personalRows.length) {
        document.getElementById('agentEmptyState').style.display = 'block';
        document.getElementById('agentContent').style.display = 'none';
        return;
    }

    document.getElementById('agentEmptyState').style.display = 'none';
    document.getElementById('agentContent').style.display = 'flex';

    const getAgentAverage = (key) => {
        const validValues = personalRows.map(r => r[key]).filter(v => v !== null && !isNaN(v));
        return validValues.length ? Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length) + '%' : '-';
    };

    const categories = [
        { label: 'Reliable Component', val: getAgentAverage('RELIABLE') },
        { label: 'Personable Attribute', val: getAgentAverage('PERSONABLE') },
        { label: 'Fast Delivery', val: getAgentAverage('FAST') },
        { label: 'Safe & Secure Policy', val: getAgentAverage('SAFE & SECURE') },
        { label: 'Overall Quality Score', val: getAgentAverage('OVERALL SCORE') }
    ];

    document.getElementById('agentScorecard').innerHTML = categories.map(cat =>
        `<div class="score-tile"><div class="num">${cat.val}</div><div class="lbl">${cat.label}</div></div>`
    ).join('');

    const chronologicallyOrdered = [...personalRows].sort((m, n) => String(n['WEEKENDING']).localeCompare(String(m['WEEKENDING'])));

    document.getElementById('agentAuditList').innerHTML = chronologicallyOrdered.map(r => {
        const localVariances = getRowIssues(r);
        const tagsLayout = localVariances.length 
            ? localVariances.map(v => `<span class="tag ${v.category}">${escapeHtml(v.label)}</span>`).join('')
            : '<span class="no-issues-note">✓ Performance target fully realized on this transaction file instance.</span>';

        return `<div class="audit-row">
            <div class="audit-head">
                <span>Timeline Target: ${escapeHtml(r['WEEKENDING'])} · Segment Context: ${escapeHtml(r['BRAND'])}</span>
                <span class="score-pill ${r['OVERALL PASSRATE'] === 'PASSED' ? 'pass-pill' : 'fail-pill'}">${r['OVERALL SCORE']}%</span>
            </div>
            <div class="audit-meta">Supervisor Assignment Line: ${escapeHtml(r['TEAM LEADER'])} · Org Unit: ${escapeHtml(r['CLUSTER'])}</div>
            <div style="margin-top: 8px;">${tagsLayout}</div>
        </div>`;
    }).join('');
}

/* ==========================================================================
   INITIALIZATION APPLICATION ENTRY HOOKS
   ========================================================================== */
window.enterDemo = enterDemo;
window.logout = logout;
window.filterData = filterData;
window.resetFilters = resetFilters;
window.regenerateMemoryDataset = regenerateMemoryDataset;

// Self invoking initial bootstrapping sequence
document.addEventListener('DOMContentLoaded', () => {
    cachedAuditRows = generateMockDataset();
    const agentSelector = document.getElementById('demoAgentPicker');
    agentSelector.innerHTML = PLDT_AGENTS.map(a => `<option value="${a.name}">${a.name} (${a.tenure})</option>`).join('');
});
