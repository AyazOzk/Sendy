const loginView = document.getElementById('loginView');
const chatView = document.getElementById('chatView');
const statusEl = document.getElementById('status');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const messagesContainer = document.getElementById('messages');
const composer = document.getElementById('composer');

let serverUrl = window.location.origin;
let token = localStorage.getItem('token');
let email = localStorage.getItem('email');
let currentDeviceId = localStorage.getItem('deviceId');
let ws;

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
}

if (!currentDeviceId) {
  currentDeviceId = generateId();
  localStorage.setItem('deviceId', currentDeviceId);
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ff453a' : '#34c759';
}

function showChat() {
  loginView.style.display = 'none';
  chatView.style.display = 'flex';
  loadMessages();
  connectWebSocket();
  checkShareTarget(); // Check if came from Share
}

function showLogin() {
  loginView.style.display = 'flex';
  chatView.style.display = 'none';
}

// Check if came from Share Target
async function checkShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const sharedTitle = params.get('title') || '';
  const sharedText = params.get('text') || '';
  const sharedUrl = params.get('url') || '';
  
  // Combine parameters
  let content = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join(' ');
  
  if (content && token) {
    
    window.history.replaceState({}, document.title, window.location.pathname);
    
    
    await fetch(`${serverUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: content })
    });
  }
}

// Authentication
async function authRequest(path) {
  const e = emailInput.value.trim();
  const p = passwordInput.value;
  if (!e || !p) return setStatus('Email and password required', true);

  const deviceName = /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile Web' : 'Web App';
  
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password: p, deviceId: currentDeviceId, deviceName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'An error occurred');

    token = data.token;
    email = data.email;
    localStorage.setItem('token', token);
    localStorage.setItem('email', email);
    showChat();
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.getElementById('loginBtn').addEventListener('click', () => authRequest('/api/login'));
document.getElementById('registerBtn').addEventListener('click', () => authRequest('/api/register'));

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('email');
  if (ws) ws.close();
  showLogin();
});

// Chat Logic
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

async function fetchImageBlobUrl(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function renderMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  wrapper.dataset.id = msg.id;
  wrapper.dataset.url = msg.url || '';

  let content;
  if (msg.type === 'text') {
    content = document.createElement('div');
    content.className = 'text-bubble' + (msg.device_id && msg.device_id !== currentDeviceId ? ' other-device' : '');
    content.textContent = msg.text;
  } else {
    content = document.createElement('a');
    content.className = 'link-card' + (msg.status === 'pending' ? ' pending' : '');
    content.href = msg.url;
    content.target = '_blank';
    
    let imgHtml = '<div class="img-container"><div style="height:140px;background:var(--border-color)"></div></div>';
    if (msg.image) {
      const blobUrl = await fetchImageBlobUrl(`${serverUrl}${msg.image}`);
      if (blobUrl) imgHtml = `<div class="img-container"><img src="${blobUrl}" alt="cover" /></div>`;
    }
    
    content.innerHTML = `
      ${imgHtml}
      <div class="content">
        <h3>${escapeHtml(msg.title || msg.url)}</h3>
        <p>${escapeHtml(msg.description || '')}</p>
        <div class="link-card-site-container">
          <img src="https://www.google.com/s2/favicons?domain=${new URL(msg.url).hostname}&sz=32" class="site-favicon" alt="" onerror="this.style.display='none'">
          <div class="link-card-site">${escapeHtml(msg.site_name || new URL(msg.url).hostname)}</div>
        </div>
      </div>
    `;
  }

  const actionsCol = document.createElement('div');
  actionsCol.className = 'actions-col';

  const delBtn = document.createElement('button');
  delBtn.className = 'action-icon-btn delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.onclick = async () => {
    await fetch(`${serverUrl}/api/messages/${msg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  };
  actionsCol.appendChild(delBtn);

  if (msg.type === 'link') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn copy';
    copyBtn.textContent = '🔗';
    copyBtn.title = 'Copy Link';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await navigator.clipboard.writeText(msg.url);
      copyBtn.textContent = '✓';
      setTimeout(() => copyBtn.textContent = '🔗', 2000);
    });
    actionsCol.appendChild(copyBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'action-icon-btn refresh';
    refreshBtn.textContent = '🔄';
    refreshBtn.title = 'Refresh Data';
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      refreshBtn.textContent = '⏳';
      await fetch(`${serverUrl}/api/messages/${msg.id}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    });
    actionsCol.appendChild(refreshBtn);
  }

  wrapper.appendChild(actionsCol);
  wrapper.appendChild(content);
  return wrapper;
}

async function upsertMessage(msg) {
  let existing = document.querySelector(`[data-id="${msg.id}"]`);
  const newEl = await renderMessage(msg);
  if (existing) {
    existing.replaceWith(newEl);
  } else {
    messagesContainer.appendChild(newEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

let currentOffset = 0;
const limit = 100;
let allLoaded = false;
let isFetching = false;
let isSearchMode = false;

async function loadMessages(loadMore = false, loadAll = false) {
  if (isFetching || (allLoaded && !loadAll)) return;
  isFetching = true;

  let url = `${serverUrl}/api/messages?limit=${limit}&offset=${currentOffset}`;
  if (loadAll) url = `${serverUrl}/api/messages?all=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) {
    const msgs = await res.json();
    
    if (msgs.length < limit && !loadAll) allLoaded = true;

    const oldScrollHeight = messagesContainer.scrollHeight;

    if (!loadMore) messagesContainer.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    for (const msg of msgs) {
      const el = await renderMessage(msg);
      fragment.appendChild(el);
    }

    if (loadMore) {
      messagesContainer.insertBefore(fragment, messagesContainer.firstChild);
      messagesContainer.scrollTop = messagesContainer.scrollHeight - oldScrollHeight;
    } else {
      messagesContainer.appendChild(fragment);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    if (loadAll) {
      allLoaded = true;
      isSearchMode = true;
    }
  }
  isFetching = false;
}

messagesContainer.addEventListener('scroll', (e) => {
  if (e.target.scrollTop === 0 && !allLoaded && !isSearchMode) {
    currentOffset += limit;
    loadMessages(true, false);
  }
});

function connectWebSocket() {
  const wsUrl = serverUrl.replace('http', 'ws') + `/ws?token=${token}`;
  ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'message:created' || msg.type === 'message:updated') {
      upsertMessage(msg.message);
    } else if (msg.type === 'message:deleted') {
      document.querySelector(`[data-id="${msg.id}"]`)?.remove();
    } else if (msg.type === 'import:done') {
      loadMessages();
    }
  };
  ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

document.getElementById('sendBtn').addEventListener('click', async () => {
  const text = composer.value.trim();
  if (!text) return;
  
  await fetch(`${serverUrl}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text })
  });
  composer.value = '';
});

composer.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('sendBtn').click();
  }
});

if (token) showChat(); else showLogin();

// Search Filter Logic
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    
    if (!isSearchMode && query.length > 0) {
      loadMessages(false, true).then(() => filterRows(query));
    } else {
      filterRows(query);
    }
    
    function filterRows(q) {
      const rows = document.querySelectorAll('.message-wrapper');
      rows.forEach(row => {
        const url = (row.dataset.url || '').toLowerCase();
        const text = row.textContent.toLowerCase();
        if (url.includes(q) || text.includes(q)) {
          row.style.display = 'flex';
        } else {
          row.style.display = 'none';
        }
      });
    }
  });
}

// Dark Mode Logic
const darkModeBtn = document.getElementById('darkModeBtn');
if (darkModeBtn) {
  const currentTheme = localStorage.getItem('theme') || 'light';
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-mode');
    darkModeBtn.textContent = '☀️';
  }
  darkModeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
      localStorage.setItem('theme', 'dark');
      darkModeBtn.textContent = '☀️';
    } else {
      localStorage.setItem('theme', 'light');
      darkModeBtn.textContent = '🌙';
    }
  });
}
