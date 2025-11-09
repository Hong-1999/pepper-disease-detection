// Configuration
// Use explicit file URLs for model and metadata (model/ folder)
const MODEL_JSON_URL = './model/model.json';
const METADATA_JSON_URL = './model/metadata.json';
const CSV_PATH = './Pepper_protection.csv'; // UTF-8 encoded CSV
const TARGET_CROP_KEYWORD = '고추'; // Filter crop rows containing this keyword
const TOP_RECOMMENDATIONS = 10;

let model = null;
let maxClasses = 0;
let csvRecords = [];
let csvHeaders = [];

const el = (id) => document.getElementById(id);
const statusEl = el('status');
const previewEl = el('preview');
const predictionEl = el('prediction');
const topKEl = el('topK');
const recoInfoEl = el('recoInfo');
const recoHeaderEl = el('recoHeader');
const recoBodyEl = el('recoBody');
const exportBtn = el('exportBtn');

// Store current recommendations for export
let currentRecommendations = { headers: [], rows: [] };

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg || '';
  statusEl.className = `status ${type}`;
}

async function ensureModel() {
  if (model) return model;

  // Check if tmImage is loaded
  if (typeof tmImage === 'undefined') {
    setStatus('Teachable Machine 라이브러리 로딩 대기 중...', 'error');
    throw new Error('tmImage 라이브러리가 로드되지 않았습니다. 페이지를 새로고침하세요.');
  }

  setStatus('모델 불러오는 중...');
  console.log('Loading model from:', MODEL_JSON_URL, METADATA_JSON_URL);
  try {
    model = await tmImage.load(MODEL_JSON_URL, METADATA_JSON_URL);
    maxClasses = model.getTotalClasses();
    console.log('Model loaded! Classes:', maxClasses);
    setStatus('모델 로드 완료', 'ok');
    return model;
  } catch (err) {
    console.error('Model load error details:', err);
    console.error('Error stack:', err.stack);
    setStatus(`모델 로드 실패: ${err.message || 'model.json/metadata.json/weights(.bin) 경로를 확인하세요.'}`, 'error');
    throw err;
  }
}

// Load CSV (UTF-8) and parse
async function loadCsv() {
  try {
    const res = await fetch(CSV_PATH);
    if (!res.ok) throw new Error(`CSV fetch error: ${res.status}`);
    // UTF-8 decoding (default)
    const text = await res.text();

    // Skip first 2 lines (title and empty line) and parse from line 3
    const lines = text.split(/\r?\n/);
    const dataText = lines.slice(2).join('\n'); // Skip first 2 lines

    // Prefer PapaParse if present
    if (window.Papa) {
      const parsed = window.Papa.parse(dataText, { header: true, skipEmptyLines: true });
      csvRecords = parsed.data.filter(Boolean);
      csvHeaders = (parsed.meta && parsed.meta.fields) || (csvRecords[0] ? Object.keys(csvRecords[0]) : []);
    } else {
      // Minimal fallback CSV parser (naive)
      const dataLines = dataText.split(/\r?\n/).filter(Boolean);
      if (!dataLines.length) return;
      csvHeaders = dataLines[0].split(',');
      csvRecords = dataLines.slice(1).map((ln) => {
        const cols = ln.split(',');
        const obj = {};
        csvHeaders.forEach((h, i) => (obj[h] = cols[i] ?? ''));
        return obj;
      });
    }
    recoInfoEl.textContent = `레코드 ${csvRecords.length}건 로드됨`;
  } catch (e) {
    console.error(e);
    recoInfoEl.textContent = 'CSV 로드 실패: Pepper_protection.csv 경로/인코딩을 확인하세요.';
  }
}

// Return all columns to show
function pickDisplayColumns(headers) {
  // Return all headers instead of filtering
  return headers;
}

function normalizeStr(s) {
  return (s || '').toString().trim();
}

function anyFieldIncludes(rec, keyword) {
  const kw = normalizeStr(keyword);
  if (!kw) return false;
  return Object.values(rec).some((v) => normalizeStr(v).includes(kw));
}

function filterRecommendations(diseaseLabel) {
  if (!csvRecords.length) return { headers: [], rows: [] };
  const displayCols = pickDisplayColumns(csvHeaders);

  // Filter by crop keyword and predicted disease label (substring match across any column)
  const rows = csvRecords.filter((rec) => {
    const cropOk = anyFieldIncludes(rec, TARGET_CROP_KEYWORD);
    const diseaseOk = anyFieldIncludes(rec, diseaseLabel);
    return cropOk && diseaseOk;
  });

  return { headers: displayCols, rows: rows.slice(0, TOP_RECOMMENDATIONS) };
}

function renderRecommendations(headers, rows) {
  console.log('Rendering recommendations, rows:', rows.length);

  // Store current recommendations for export
  currentRecommendations = { headers, rows };

  // Header
  recoHeaderEl.innerHTML = '';
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    recoHeaderEl.appendChild(th);
  });
  // Body
  recoBodyEl.innerHTML = '';
  rows.forEach((rec) => {
    const tr = document.createElement('tr');
    headers.forEach((h) => {
      const td = document.createElement('td');
      td.textContent = normalizeStr(rec[h]);
      tr.appendChild(td);
    });
    recoBodyEl.appendChild(tr);
  });

  // Show/hide export button based on recommendations
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = Math.max(headers.length, 1);
    td.className = 'muted';
    td.textContent = '해당 조건에 맞는 추천 항목이 없습니다. (라벨/CSV 컬럼 확인 필요)';
    tr.appendChild(td);
    recoBodyEl.appendChild(tr);
    if (exportBtn) {
      exportBtn.style.display = 'none';
      console.log('No recommendations, hiding export button');
    }
  } else {
    // Show export button when there are recommendations
    if (exportBtn) {
      exportBtn.style.display = 'inline-block';
      exportBtn.style.visibility = 'visible';
      console.log('Recommendations found, showing export button');
    }
  }
}

function renderTopK(preds) {
  topKEl.innerHTML = '';
  preds.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `${p.className} — ${(p.probability * 100).toFixed(1)}%`;
    topKEl.appendChild(li);
  });
}

async function predictFromImage(imgEl) {
  try {
    await ensureModel();
    setStatus('이미지 예측 중...');
    const preds = await model.predict(imgEl);
    const sorted = preds.slice().sort((a, b) => b.probability - a.probability);
    const top = sorted[0];
    predictionEl.textContent = `예측: ${top.className} (${(top.probability * 100).toFixed(1)}%)`;
    renderTopK(sorted);
    setStatus('완료', 'ok');

    // Recommend
    const { headers, rows } = filterRecommendations(top.className);
    renderRecommendations(headers, rows);
  } catch (e) {
    console.error('Prediction error:', e);
    setStatus(`이미지 예측 중 오류: ${e.message || '알 수 없는 오류'}`, 'error');
    predictionEl.textContent = '';
    topKEl.innerHTML = '';
  }
}

// Image upload handling
function setupUpload() {
  const input = document.getElementById('fileInput');
  input.addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setStatus('이미지 파일만 업로드 가능합니다.', 'error');
      return;
    }

    const imgUrl = URL.createObjectURL(file);
    previewEl.src = imgUrl;

    // Clean up object URL on load or error
    previewEl.onload = () => {
      URL.revokeObjectURL(imgUrl);
      predictFromImage(previewEl);
    };
    previewEl.onerror = () => {
      URL.revokeObjectURL(imgUrl);
      setStatus('이미지 로드 실패', 'error');
    };
  });
}

// Wait for all libraries to load
function waitForLibraries() {
  return new Promise((resolve) => {
    console.log('Checking libraries...');
    console.log('tf:', typeof tf);
    console.log('tmImage:', typeof tmImage);

    const checkInterval = setInterval(() => {
      if (typeof tf !== 'undefined' && typeof tmImage !== 'undefined') {
        console.log('Libraries loaded successfully!');
        clearInterval(checkInterval);
        setStatus('라이브러리 로드 완료', 'ok');
        resolve();
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      console.log('Timeout - tf:', typeof tf, 'tmImage:', typeof tmImage);
      if (typeof tmImage === 'undefined') {
        setStatus('라이브러리 로드 실패. 인터넷 연결을 확인하거나 페이지를 새로고침하세요.', 'error');
      }
      resolve();
    }, 10000);
  });
}

// Export to CSV (Excel compatible) functionality
function exportToCSV() {
  const { headers, rows } = currentRecommendations;

  if (!rows.length) {
    alert('다운로드할 데이터가 없습니다.');
    return;
  }

  // Create CSV content with UTF-8 BOM for Excel compatibility
  const BOM = '\uFEFF';
  const headerRow = headers.join(',');
  const dataRows = rows.map(row => {
    return headers.map(header => {
      const value = normalizeStr(row[header]);
      // Escape values containing comma, quotes, or newlines
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });

  const csvContent = BOM + headerRow + '\n' + dataRows.join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  // Generate filename with current date
  const date = new Date().toISOString().split('T')[0];
  const prediction = predictionEl.textContent.replace('예측: ', '').split(' ')[0];
  const filename = `권장농약_${prediction}_${date}.csv`;

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function setupExport() {
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToCSV);
  } else {
    console.error('Export button not found!');
  }
}

// Boot
window.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded');
  await waitForLibraries();
  setupUpload();
  setupExport();
  await loadCsv();
});
