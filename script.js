/* ==========================================================================
   PLDT QUALITY SCORE DASHBOARD — LIVE DEMO BUILD
   No backend, no accounts. All data below is randomly generated on load.
   ========================================================================== */

let currentSession = null; // { role: 'supervisor' | 'agent', agentName? }
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

/* Forgiving name comparison for matching roster entries to raw-data rows.
   Strips accents/diacritics (Muñoz -> Munoz), punctuation, common suffixes
   (Jr., Sr., II, III), and collapses extra whitespace — so small spelling
   differences between the two files don't break the match. */
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

        // descriptive: anything that isn't a known "no issue" marker is a hit.
        // If the cell has real text beyond a bare "Yes", show that instead of
        // the generic label — it's the actual reason the auditor wrote down.
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

/* ==========================================================================
   MOCK DATA GENERATION
   ========================================================================== */
const DEMO_AGENTS = [
    { name: 'Santos, Maria Cristina', tenure: '>91 DAYS' },
    { name: 'Reyes, Mark Anthony', tenure: '>91 DAYS' },
    { name: 'Dela Cruz, Angelica', tenure: '31-60 DAYS' },
    { name: 'Bautista, Miguel', tenure: '>91 DAYS' },
    { name: 'Garcia, Kristine Joy', tenure: '0-30 DAYS' },
    { name: 'Mendoza, Paolo', tenure: '>91 DAYS' },
    { name: 'Torres, Angeline', tenure: '31-60 DAYS' },
    { name: 'Ramos, Christian', tenure: '>91 DAYS' },
    { name: 'Flores, Bianca', tenure: '>91 DAYS' },
    { name: 'Aquino, Rafael', tenure: '0-30 DAYS' },
    { name: 'Villanueva, Samantha', tenure: '>91 DAYS' },
    { name: 'Castillo, Enzo', tenure: '31-60 DAYS' }
];
const DEMO_TEAM_LEADERS = ['Fernandez, Ma. Luisa', 'Domingo, Kevin', 'Salazar, Patricia', 'Navarro, Justin'];
const DEMO_CLUSTERS = ['A', 'B', 'C', 'D'];
const DEMO_BRANDS = ['PLDT HOME', 'PLDT ENTERPRISE'];
const DEMO_FORM_TYPES = ['Program Level', 'Agent Level'];
const DEMO_WEEKS = [
    ['WE0503', 'MAY'], ['WE0510', 'MAY'], ['WE0517', 'MAY'], ['WE0524', 'MAY'], ['WE0531', 'MAY'],
    ['WE0607', 'JUNE'], ['WE0614', 'JUNE'], ['WE0621', 'JUNE'], ['WE0628', 'JUNE'],
    ['WE0705', 'JULY'], ['WE0712', 'JULY'], ['WE0719', 'JULY']
];
const DEMO_REMARKS = [
    'Agent provided incomplete information regarding the service downgrade request.',
    'Customer had to repeat the concern twice before the agent fully understood the issue.',
    'Agent used dismissive language when the customer raised a billing complaint.',
    'Resolution offered did not match what the customer actually asked for.',
    'Agent did not confirm the customer\'s account details before discussing the case.',
    'Ticket was not created despite the customer requesting a follow-up.',
    'Agent sounded rushed and did not fully explain the next steps to the customer.',
    'Correct process was followed, but the explanation given was unclear.'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateMockData() {
    const rows = [];
    let idCounter = 1;

    DEMO_AGENTS.forEach(agent => {
        const auditCount = randInt(3, 7);
        const weeksForAgent = [...DEMO_WEEKS].sort(() => Math.random() - 0.5).slice(0, auditCount);

        weeksForAgent.forEach(([weekending, month]) => {
            const roll = Math.random();
            // weighted: 65% clean/high score, 22% mid, 13% low
            const overall = roll < 0.65 ? randInt(90, 100) : roll < 0.87 ? randInt(75, 89) : randInt(40, 74);
            const jitter = () => Math.max(0, Math.min(100, overall + randInt(-6, 6)));

            const row = {
                'FORM TYPE': pick(DEMO_FORM_TYPES),
                'BRAND': pick(DEMO_BRANDS),
                'LINE OF BUSINESS': '',
                'AGENT/OFFICER NAME': agent.name,
                'AGENT TENURE': agent.tenure,
                'TEAM LEADER': pick(DEMO_TEAM_LEADERS),
                'CLUSTER': pick(DEMO_CLUSTERS),
                'WEEKENDING': weekending,
                'MONTH': month,
                'MISTREAT': '100%',
                'RELIABLE': jitter(),
                'PERSONABLE': jitter(),
                'FAST': jitter(),
                'SAFE & SECURE': jitter(),
                'OVERALL SCORE': overall,
                'EE number/ID number': String(52500000 + idCounter),
                'OVERALL PASSRATE': overall >= 85 ? 'PASSED' : 'FAILED',
                'CM': overall >= 90 ? 'SUPERSTAR' : 'UNDERPERFORMER',
                'RELIABLE: ADDITIONAL COMMENTS': '',
                'PERSONABLE: ADDITIONAL COMMENTS': '',
                'FAST: ADDITIONAL COMMENTS': '',
                'IS THIS A POTENTIAL CUSTOMER MISTREAT?': 'No'
            };

            HIT_PARAMS.forEach(p => {
                if (p.col === 'IS THIS A POTENTIAL CUSTOMER MISTREAT?') return;
                row[p.col] = p.type === 'boolean' ? 'Yes' : 'No Opportunity';
            });

            if (overall < 85) {
                const flagCount = overall < 70 ? randInt(2, 4) : randInt(1, 2);
                const flaggable = HIT_PARAMS.filter(p => p.col !== 'IS THIS A POTENTIAL CUSTOMER MISTREAT?');
                const chosen = [...flaggable].sort(() => Math.random() - 0.5).slice(0, flagCount);
                chosen.forEach(p => {
                    row[p.col] = p.type === 'boolean' ? 'No' : pick(DEMO_REMARKS);
                });
                const commentField = pick(['RELIABLE: ADDITIONAL COMMENTS', 'PERSONABLE: ADDITIONAL COMMENTS', 'FAST: ADDITIONAL COMMENTS']);
                row[commentField] = pick(DEMO_REMARKS) + ' ' + pick(DEMO_REMARKS);
            }

            idCounter++;
            rows.push(row);
        });
    });

    return rows;
}

function populateDemoAgentPicker() {
    const sel = document.getElementById('demoAgentPicker');
    sel.innerHTML = DEMO_AGENTS.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
}

/* ==========================================================================
   DEMO ENTRY / NAVIGATION
   ========================================================================== */
function enterDemo(role) {
    if (role === 'supervisor') {
        currentSession = { role: 'supervisor' };
    } else {
        const agentName = document.getElementById('demoAgentPicker').value;
        currentSession = { role: 'agent', agentName };
    }
    enterApp();
}

function logout() {
    currentSession = null;
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'none';
}

function enterApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
    document.getElementById('sessionChip').style.display = 'flex';
    document.getElementById('sessionLabel').textContent =
        (currentSession.role === 'supervisor' ? '\ud83d\udc64 Supervisor (Demo)' : '\ud83d\udc64 Agent (Demo) \u00b7 ' + currentSession.agentName);

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

/* cachedAuditRows is declared once at the top of the file. */

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
        document.getElementById('clusterChart').innerHTML = '<div class="empty-note">No matching data.</div>';
        document.getElementById('topHitsTable').querySelector('tbody').innerHTML = '<tr><td colspan="3" class="empty-note">No matching data.</td></tr>';
        return;
    }

    const avg = (key) => {
        const vals = data.map(r => r[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
        if (!vals.length) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const avgReliable = avg('RELIABLE'), avgPersonable = avg('PERSONABLE'), avgFast = avg('FAST'),
          avgSecure = avg('SAFE & SECURE'), avgOverall = avg('OVERALL SCORE');

    const setBar = (valId, barId, val) => {
        document.getElementById(valId).textContent = val === null ? '-' : val + '%';
        document.getElementById(barId).style.height = (val || 0) + '%';
    };
    setBar('valReliable', 'barReliable', avgReliable);
    setBar('valPersonable', 'barPersonable', avgPersonable);
    setBar('valFast', 'barFast', avgFast);
    setBar('valSecure', 'barSecure', avgSecure);
    setBar('valOverall', 'barOverall', avgOverall);

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

    // CM Distribution — uses the authoritative CM column from the source
    // data (SUPERSTAR / UNDERPERFORMER) rather than a guessed threshold.
    const cmRows = data.filter(r => r['CM']);
    if (cmRows.length) {
        const superstar = cmRows.filter(r => r['CM'] === 'SUPERSTAR').length;
        document.getElementById('cmSuperstarVal').textContent = Math.round((superstar / cmRows.length) * 100) + '%';
        document.getElementById('cmUnderperformerVal').textContent = Math.round(((cmRows.length - superstar) / cmRows.length) * 100) + '%';
    } else {
        document.getElementById('cmSuperstarVal').textContent = '-';
        document.getElementById('cmUnderperformerVal').textContent = '-';
    }

    // Team leader chart
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

    // Cluster chart
    const clusterScores = {};
    data.forEach(r => {
        const c = r['CLUSTER'] || 'Unassigned';
        if (!clusterScores[c]) clusterScores[c] = { total: 0, count: 0 };
        if (r['OVERALL SCORE'] !== null) { clusterScores[c].total += r['OVERALL SCORE']; clusterScores[c].count++; }
    });
    const clusterChart = document.getElementById('clusterChart');
    clusterChart.innerHTML = Object.entries(clusterScores).map(([c, s]) => {
        const a = s.count ? Math.round(s.total / s.count) : 0;
        return `<div class="horizontal-bar-row">
            <div class="horizontal-label" title="${c}">${c}</div>
            <div class="horizontal-bar-container"><div class="horizontal-bar-fill" style="width:${a}%; background:#C8102E;">${a}%</div></div>
        </div>`;
    }).join('') || '<div class="empty-note">No matching data.</div>';

    // Top hit parameters
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
}

function renderAgentView() {
    document.getElementById('agentWelcomeName').textContent = 'Welcome, ' + (currentSession.agentName || currentSession.email);

    const myRows = cachedAuditRows.filter(r => r['AGENT/OFFICER NAME'] === currentSession.agentName);

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
                <span>${escapeHtml(r['WEEKENDING'])} · ${escapeHtml(r['FORM TYPE'])} · ${escapeHtml(r['BRAND'])}</span>
                <span class="score-pill ${passed ? 'pass-pill' : 'fail-pill'}">${score === null ? '-' : score + '%'}</span>
            </div>
            <div class="audit-meta">Team Leader: ${escapeHtml(r['TEAM LEADER']) || '—'} · Cluster: ${escapeHtml(r['CLUSTER']) || '—'} · Month: ${escapeHtml(r['MONTH']) || '—'}</div>
            <div>${tagsHtml}</div>
            ${commentsHtml}
        </div>`;
    };

    // Group by month, ordered by each group's most recent weekending —
    // the newest month opens expanded, older months collapse under a
    // click-to-expand header so the list doesn't turn into an endless scroll.
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
   EXPOSE TO WINDOW
   Needed because this file is an ES module (module scope), but the HTML
   still calls these via inline onclick/onchange attributes.
   ========================================================================== */

window.enterDemo = enterDemo;
window.logout = logout;
window.filterData = filterData;
window.resetFilters = resetFilters;

/* ==========================================================================
   INIT
   ========================================================================== */
cachedAuditRows = generateMockData();
populateDemoAgentPicker();
