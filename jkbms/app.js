// app.js
document.addEventListener("DOMContentLoaded", () => {
  // Initialize cell matrix (24 elements)
  const cellGrid = document.getElementById('cell-grid');
  for (let i = 1; i <= 24; i++) {
    const cellBox = document.createElement('div');
    cellBox.className = 'cell-box';
    cellBox.id = `cell-box-${i}`;
    cellBox.innerHTML = `
      <span class="cell-num">#${String(i).padStart(2, '0')}</span>
      <div class="cell-volt" id="cell-v-${i}">--</div>
      <div class="cell-bar-container">
        <div class="cell-bar-fill" id="cell-bar-${i}"></div>
      </div>
    `;
    cellGrid.appendChild(cellBox);
  }

  // Read npoint key from localStorage or use default
  let npointKey = localStorage.getItem('npoint_key') || '0d6013fe3fa362ab0388';
  const keyInput = document.getElementById('npoint-key');
  keyInput.value = npointKey;

  // Countdown timer setup
  let count = 10;
  const countdownEl = document.getElementById('countdown');
  let pollInterval = null;
  let timerInterval = null;

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      count--;
      if (count < 0) {
        count = 10;
        fetchData();
      }
      countdownEl.innerText = `${count}s`;
    }, 1000);
  }

  // Handle key input change
  keyInput.addEventListener('change', () => {
    const val = keyInput.value.trim();
    if (val.length > 5) {
      npointKey = val;
      localStorage.setItem('npoint_key', npointKey);
      count = 10;
      fetchData();
    }
  });

  // Fetch telemetry from npoint.io
  async function fetchData() {
    try {
      const response = await fetch(`https://api.npoint.io/${npointKey}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error("Gagal mengambil data");
      const data = await response.json();
      if (data) {
        updateUI(data);
      }
    } catch (error) {
      console.error("Error fetching telemetry:", error);
      document.getElementById('status-dot').className = 'status-dot';
      document.getElementById('status-text').innerText = 'Offline';
    }
  }

  // Update HUD UI Elements
  function updateUI(data) {
    // Connection status dot & text
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    if (data.connectionStatus === 'connected') {
      statusDot.className = 'status-dot connected';
      statusText.innerText = 'Connected';
    } else {
      statusDot.className = 'status-dot';
      statusText.innerText = 'Disconnected';
    }

    // Telemetry fields
    const tel = data.telemetry || {};
    
    // SOC Gauge Fill and Numeric readout
    const socVal = parseInt(tel.soc) || 0;
    document.getElementById('soc-value').innerText = socVal;
    const circleRadius = 90;
    const circumference = 2 * Math.PI * circleRadius;
    const offset = circumference - (socVal / 100) * circumference;
    document.getElementById('soc-gauge-fill').style.strokeDashoffset = offset;

    // Voltage & Current
    document.getElementById('voltage-value').innerText = `${(tel.totalVoltage || 0).toFixed(2)} V`;
    document.getElementById('current-value').innerText = `${(tel.current || 0).toFixed(2)} A`;
    
    // Detailed Telemetry Panel
    document.getElementById('power-value').innerText = `${tel.power || 0} W`;
    document.getElementById('capacity-value').innerText = `${(tel.capacityRemaining || 0).toFixed(2)} Ah`;
    document.getElementById('cycles-value').innerText = tel.chargingCycles || 0;
    
    // Temperatures
    document.getElementById('mosfet-temp').innerText = `${(tel.mosfetTemp || 0).toFixed(1)} °C`;
    document.getElementById('temp-1').innerText = `${(tel.temp1 || 0).toFixed(1)} °C`;
    document.getElementById('temp-2').innerText = `${(tel.temp2 || 0).toFixed(1)} °C`;

    // Cell bounds and delta
    document.getElementById('max-min-volt').innerText = 
      `${(tel.maxCellVoltage || 0).toFixed(3)} / ${(tel.minCellVoltage || 0).toFixed(3)} V`;
    document.getElementById('delta-volt').innerText = `${(tel.deltaCellVoltage || 0).toFixed(3)} V`;
    document.getElementById('error-status').innerText = tel.status || 'OK';

    // Switches Status Update
    const sw = data.status || {};
    updateSwitch('charging-switch', sw.charging);
    updateSwitch('discharging-switch', sw.discharging);
    updateSwitch('balancing-switch', sw.balancing);
    updateSwitch('heating-switch', sw.heating);

    // Cell Matrix Array Update
    const cells = data.cells || [];
    for (let i = 1; i <= 24; i++) {
      const val = cells[i-1];
      const box = document.getElementById(`cell-box-${i}`);
      const text = document.getElementById(`cell-v-${i}`);
      const fill = document.getElementById(`cell-bar-${i}`);
      
      if (val > 1.0) { // Cell is active
        box.className = 'cell-box active';
        text.innerText = `${val.toFixed(3)}V`;
        
        // Map voltage range 2.5V - 4.2V to progress bar width 0% - 100%
        let percent = ((val - 2.5) / 1.7) * 100;
        percent = Math.max(0, Math.min(100, percent));
        fill.style.width = `${percent}%`;
      } else {
        box.className = 'cell-box';
        text.innerText = '--';
        fill.style.width = '0%';
      }
    }
  }

  function updateSwitch(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    if (state) {
      el.className = 'switch-state active';
      el.innerText = 'ON';
    } else {
      el.className = 'switch-state inactive';
      el.innerText = 'OFF';
    }
  }

  // --- Remote Settings Logic ---
  let npointSettingsKey = localStorage.getItem('npoint_settings_key') || '221e52dae874886815ce';
  let npointToken = localStorage.getItem('npoint_token') || '';
  const keySettingsInput = document.getElementById('npoint-key-settings');
  const tokenInput = document.getElementById('npoint-token');
  if(keySettingsInput) keySettingsInput.value = npointSettingsKey;
  if(tokenInput) tokenInput.value = npointToken;
  
  if(keySettingsInput) {
    keySettingsInput.addEventListener('change', () => {
      npointSettingsKey = keySettingsInput.value.trim();
      localStorage.setItem('npoint_settings_key', npointSettingsKey);
      fetchSettings();
    });
  }
  if(tokenInput) {
    tokenInput.addEventListener('change', () => {
      npointToken = tokenInput.value.trim();
      localStorage.setItem('npoint_token', npointToken);
    });
  }

  async function fetchSettings() {
    try {
      const response = await fetch(`https://api.npoint.io/${npointSettingsKey}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error("Gagal mengambil settings");
      const data = await response.json();
      if (data && data.settings) {
        const s = data.settings;
        const e = (id, val) => { const el = document.getElementById(id); if(el && document.activeElement !== el) el.value = val; };
        e('remote-relay-mode', s.relayMode || 'AUTO');
        e('remote-lfp-full', s.lfpFull || 95);
        e('remote-lfp-low', s.lfpLow || 10);
        e('remote-aki-min', s.akiMin || 34.5);
        e('remote-aki-max', s.akiMax || 36.5);
        e('remote-ups-on', s.upsOnVoltage || 37.0);
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  }

  const saveBtn = document.getElementById('btn-save-settings');
  if(saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
      const settingsData = {
        settings: {
          relayMode: v('remote-relay-mode'),
          lfpFull: parseFloat(v('remote-lfp-full')),
          lfpLow: parseFloat(v('remote-lfp-low')),
          akiMin: parseFloat(v('remote-aki-min')),
          akiMax: parseFloat(v('remote-aki-max')),
          upsOnVoltage: parseFloat(v('remote-ups-on'))
        },
        ts: Math.floor(Date.now() / 1000)
      };
      
      saveBtn.innerText = "SAVING...";
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (npointToken) {
          headers['Authorization'] = `Bearer ${npointToken}`;
        }

        
        const res = await fetch(`https://api.npoint.io/${npointSettingsKey}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(settingsData)
        });
        if(!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        saveBtn.innerText = "SUCCESS";
        setTimeout(() => saveBtn.innerText = "SAVE TO CLOUD", 2000);
      } catch (err) {
        console.error("Save Error:", err);
        saveBtn.innerText = "ERROR";
        setTimeout(() => saveBtn.innerText = "SAVE TO CLOUD", 2000);
        alert("Gagal menyimpan: " + err.message);
      }
    });
  }

  // Start initialization
  fetchData();
  fetchSettings();
  startTimer();
});
