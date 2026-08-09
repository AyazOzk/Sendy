const statusEl = document.getElementById('status');
const serverUrlInput = document.getElementById('serverUrl');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loggedInBox = document.getElementById('loggedInBox');
const loggedEmail = document.getElementById('loggedEmail');
const sessionsContainer = document.getElementById('sessionsContainer');

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ff453a' : '#30d158';
}

async function init() {
  let { serverUrl, token, email, deviceId } = await browser.storage.local.get(['serverUrl', 'token', 'email', 'deviceId']);
  if (!deviceId) {
    deviceId = generateId();
    await browser.storage.local.set({ deviceId });
  }
  if (serverUrl) serverUrlInput.value = serverUrl;
  if (token && email) {
    loggedInBox.style.display = 'block';
    loggedEmail.textContent = email;
    loadSessions(serverUrl, token, deviceId);
  }
}

async function loadSessions(serverUrl, token, currentDeviceId) {
  try {
    const res = await fetch(`${serverUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const sessions = await res.json();
    sessionsContainer.innerHTML = '';
    
    sessions.forEach(s => {
      const isCurrent = s.device_id === currentDeviceId;
      const d = new Date(s.last_active + 'Z');
      const item = document.createElement('div');
      item.className = 'session-item';
      item.innerHTML = `
        <div class="session-info">
          <strong>${s.device_name} ${isCurrent ? '(This Device)' : ''}</strong>
          <small>Last seen: ${d.toLocaleString('tr-TR')}</small>
        </div>
      `;
      if (!isCurrent) {
        const btn = document.createElement('button');
        btn.className = 'revoke-btn';
        btn.textContent = 'Logout';
        btn.onclick = async () => {
          await fetch(`${serverUrl}/api/sessions/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ deviceId: s.device_id })
          });
          item.remove();
        };
        item.appendChild(btn);
      }
      sessionsContainer.appendChild(item);
    });
  } catch (e) {
    sessionsContainer.innerHTML = '<small style="color:red;">Failed to load devices</small>';
  }
}

async function ensureHostPermission(serverUrl) {
  try {
    const origin = new URL(serverUrl).origin + '/*';
    const granted = await browser.permissions.request({ origins: [origin] });
    return granted;
  } catch {
    return false;
  }
}

async function authRequest(path) {
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!serverUrl) return setStatus('Enter server address', true);
  if (!email || !password) return setStatus('Email and password are required', true);

  await ensureHostPermission(serverUrl);

  try {
    const { deviceId } = await browser.storage.local.get('deviceId');
    // Get browser info
    const deviceName = navigator.userAgent.includes('Firefox') ? 'Firefox' : (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Browser');
    
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId, deviceName: navigator.userAgent.split(' ')[0] + ' ' + deviceName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'An error occurred');

    await browser.storage.local.set({
      serverUrl,
      token: data.token,
      email: data.email,
    });
    setStatus(path === '/api/register' ? 'Registration successful, logged in ✅' : 'Login successful ✅');
    loggedInBox.style.display = 'block';
    loggedEmail.textContent = data.email;
    loadSessions(serverUrl, data.token, deviceId);
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.getElementById('loginBtn').addEventListener('click', () => authRequest('/api/login'));
document.getElementById('registerBtn').addEventListener('click', () => authRequest('/api/register'));

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await browser.storage.local.remove(['token', 'email']);
  loggedInBox.style.display = 'none';
  setStatus('Logged out');
});

init();

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
