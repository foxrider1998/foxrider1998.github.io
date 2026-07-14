// ====================================================================
// JKBMS V19 LCD DASHBOARD - CLIENT CONTROLLER & DECODER
// ====================================================================

let ws;
let isSettingsDirty = false;
let currentCellCount = 0;

// Web Bluetooth state variables
let bleDevice = null;
let bleServer = null;
let bleService = null;
let bleRxChar = null;
let bleTxChar = null;
let bleQueryTimer = null;
let bleConnectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected'
let rxBuffer = new Uint8Array(0);

// Cloud remote sync variables
let remotePollTimer = null;
let broadcastTimer = null;
let bleDataReady = false; // Only true after first successful BLE frame parsed

// Local State (for Web Bluetooth or local simulation)
let localBmsState = {
  mode: 'remote', // Default to Cloud Remote View
  connectionStatus: 'disconnected',
  connectedDevice: null,
  telemetry: {
    cells: Array.from({ length: 16 }, (_, i) => ({
      index: i + 1,
      voltage: 3.310 + (Math.sin(i * 0.5) * 0.015),
      balancing: false
    })),
    totalVoltage: 52.95,
    current: 0.0,
    power: 0.0,
    soc: 85,
    remainingCapacity: 238.0,
    totalCapacity: 280.0,
    cycleCount: 42,
    temperatures: {
      mosfet: 32.5,
      temp1: 28.2,
      temp2: 29.0
    },
    balancersActive: false,
    balanceCurrent: 0.0,
    warnings: [],
    switches: {
      charge: true,
      discharge: true,
      balance: true
    }
  },
  settings: {
    cellCount: 16,
    nominalCapacity: 280,
    cellOvervoltageProtect: 3.65,
    cellUndervoltageProtect: 2.50,
    cellOvervoltageRecovery: 3.55,
    cellUndervoltageRecovery: 2.80,
    maxChargeCurrent: 100.0,
    maxDischargeCurrent: 150.0,
    balanceStartVoltage: 3.20,
    balanceTriggerDiff: 0.010,
    maxBalanceCurrent: 2.0
  }
};

// Local Simulator loop (used when offline/standalone)
let localSimInterval = null;
let localSimDirection = 1;
let localSimCurrentBase = 12.5;

// DOM Elements - Header controls
const modeSelect = document.getElementById('mode-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const reconnectBtn = document.getElementById('reconnect-btn');
const remoteKeyContainer = document.getElementById('remote-key-container');
const remoteKeyInput = document.getElementById('remote-key-input');
const statusKeyDisplay = document.getElementById('status-key-display');

// DOM Elements - Tab 1 (Informasi)
const infoVoltage = document.getElementById('info-voltage');
const infoCurrent = document.getElementById('info-current');
const infoCurrentGlow = document.getElementById('info-current-glow');
const socFillRing = document.getElementById('soc-fill-ring');
const infoSoc = document.getElementById('info-soc');
const infoCapacityTot = document.getElementById('info-capacity-tot');
const infoCapacityRem = document.getElementById('info-capacity-rem');
const infoMaxCell = document.getElementById('info-max-cell');
const infoMinCell = document.getElementById('info-min-cell');
const infoTemp = document.getElementById('info-temp');
const infoPower = document.getElementById('info-power');
const infoAlarm = document.getElementById('info-alarm');
const infoPacks = document.getElementById('info-packs');
const indChg = document.getElementById('ind-chg');
const indDch = document.getElementById('ind-dch');

// DOM Elements - Tab 2 (Parameter)
const paramDelta = document.getElementById('param-delta');
const paramBalanceCurrent = document.getElementById('param-balance-current');
const paramCycles = document.getElementById('param-cycles');
const cellsGrid = document.getElementById('cells-grid');

// DOM Elements - Tab 3 (Setelan)
const switchCharge = document.getElementById('set-switch-charge');
const switchDischarge = document.getElementById('set-switch-discharge');
const switchBalance = document.getElementById('set-switch-balance');
const switchBroadcast = document.getElementById('set-switch-broadcast');
const broadcastSwitchContainer = document.getElementById('broadcast-switch-container');
const setTempMos = document.getElementById('set-temp-mos');
const setTempT1 = document.getElementById('set-temp-t1');
const setTempT2 = document.getElementById('set-temp-t2');
const writeSettingsBtn = document.getElementById('write-settings-btn');
const settingsSync = document.getElementById('settings-sync');

// DOM Elements - Toast & Tabs
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');
const navButtons = document.querySelectorAll('.lcd-nav-btn');
const tabPanes = document.querySelectorAll('.lcd-tab-pane');

// ----------------------------------------------------
// TAB SYSTEM ROUTING
// ----------------------------------------------------
navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTabId = btn.getAttribute('data-target');
        
        // Toggle active button
        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Toggle active pane
        tabPanes.forEach(pane => {
            if (pane.id === targetTabId) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
        
        console.log(`[Tab] Switched to ${targetTabId}`);
    });
});

// ----------------------------------------------------
// WEBSOCKET BACKEND HUB (Optional fallback for local node devs)
// ----------------------------------------------------
function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    
    console.log(`[WS] Connecting to backend: ${wsUrl}`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[WS] Connected to backend server.');
        showToast('Koneksi Backend Server Aktif', 'success');
        ws.send(JSON.stringify({ type: 'set_mode', value: modeSelect.value }));
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'state') {
                // Ignore WebSocket telemetry if we are in local Web BLE or Remote View modes
                if (localBmsState.mode !== 'webble' && localBmsState.mode !== 'remote') {
                    localBmsState = message.data;
                    updateUI(localBmsState);
                }
            }
        } catch (e) {
            console.error('[WS] Parsing error:', e);
        }
    };

    ws.onclose = () => {
        console.warn('[WS] Backend disconnected. Running in Standalone Browser mode.');
        if (localBmsState.mode === 'simulated') {
            startLocalSimulator();
        }
    };

    ws.onerror = (err) => {
        console.warn('[WS] Backend not available.');
    };
}

// ----------------------------------------------------
// UI UPDATE DISPATCHER
// ----------------------------------------------------
function updateUI(bms) {
    if (!bms) return;

    modeSelect.value = bms.mode;

    statusDot.className = 'status-indicator-dot';
    
    if (bms.mode === 'simulated') {
        statusDot.classList.add('disconnected');
        statusText.innerText = 'VIRTUAL SIMULATOR (DEMO)';
        reconnectBtn.style.display = 'none';
        if (remoteKeyContainer) remoteKeyContainer.classList.add('hidden');
        broadcastSwitchContainer.classList.add('hidden');
    } else if (bms.mode === 'remote') {
        reconnectBtn.style.display = 'none';
        if (remoteKeyContainer) remoteKeyContainer.classList.add('hidden');
        broadcastSwitchContainer.classList.add('hidden');
        
        // Remote connection status
        if (bleConnectionStatus === 'connected') {
            statusDot.classList.add('connected');
        } else {
            statusDot.classList.add('disconnected');
        }
    } else {
        // webble mode
        reconnectBtn.style.display = 'inline-flex';
        if (remoteKeyContainer) remoteKeyContainer.classList.add('hidden');
        
        // Display broadcast switch if Bluetooth is connected
        if (bleConnectionStatus === 'connected') {
            broadcastSwitchContainer.classList.remove('hidden');
        } else {
            broadcastSwitchContainer.classList.add('hidden');
            stopBroadcasting();
        }
        
        switch (bleConnectionStatus) {
            case 'disconnected':
                statusDot.classList.add('disconnected');
                statusText.innerText = 'BMS DISCONNECTED';
                reconnectBtn.innerHTML = '<i data-lucide="refresh-cw"></i> SAMBUNGKAN BT';
                break;
            case 'connecting':
                statusDot.classList.add('connecting');
                statusText.innerText = 'MEMILIH/MENGHUBUNGKAN...';
                reconnectBtn.innerHTML = '<i data-lucide="x"></i> BATALKAN';
                break;
            case 'connected':
                statusDot.classList.add('connected');
                statusText.innerText = 'BMS CONNECTED';
                reconnectBtn.innerHTML = '<i data-lucide="x"></i> PUTUSKAN';
                break;
        }
        lucide.createIcons();
    }

    const tel = bms.telemetry;
    const sett = bms.settings;

    if (tel) {
        infoVoltage.innerText = tel.totalVoltage.toFixed(2);
        infoCurrent.innerText = Math.abs(tel.current).toFixed(1);
        
        if (tel.current > 0.05) {
            infoCurrentGlow.style.color = 'var(--lcd-green)';
            infoCurrentGlow.style.textShadow = '0 0 8px var(--lcd-green-glow)';
        } else if (tel.current < -0.05) {
            infoCurrentGlow.style.color = 'var(--lcd-red)';
            infoCurrentGlow.style.textShadow = '0 0 8px var(--lcd-red-glow)';
        } else {
            infoCurrentGlow.style.color = 'var(--lcd-white)';
            infoCurrentGlow.style.textShadow = 'none';
        }

        infoSoc.innerText = tel.soc;
        const strokeDashOffset = 314 - (314 * tel.soc) / 100;
        socFillRing.style.strokeDashoffset = strokeDashOffset;

        if (tel.soc <= 20) {
            socFillRing.style.stroke = 'var(--lcd-red)';
        } else if (tel.soc <= 50) {
            socFillRing.style.stroke = 'var(--lcd-orange)';
        } else {
            socFillRing.style.stroke = 'var(--lcd-green)';
        }

        infoCapacityTot.innerText = tel.totalCapacity.toFixed(1);
        infoCapacityRem.innerText = tel.remainingCapacity.toFixed(1);

        const powerKw = tel.power / 1000;
        infoPower.innerText = powerKw.toFixed(2);

        infoTemp.innerText = `${Math.round(tel.temperatures.mosfet)}°C`;

        if (tel.switches.charge) {
            indChg.innerText = 'ON';
            indChg.className = 'sw-ind-text';
        } else {
            indChg.innerText = 'OFF';
            indChg.className = 'sw-ind-text off';
        }

        if (tel.switches.discharge) {
            indDch.innerText = 'ON';
            indDch.className = 'sw-ind-text';
        } else {
            indDch.innerText = 'OFF';
            indDch.className = 'sw-ind-text off';
        }

        if (tel.warnings && tel.warnings.length > 0) {
            infoAlarm.innerText = 'ALARM';
            infoAlarm.className = 'alarm-badge red-badge';
        } else {
            infoAlarm.innerText = 'NORMAL';
            infoAlarm.className = 'alarm-badge green-badge';
        }

        infoPacks.innerText = '1';

        paramCycles.innerText = tel.cycleCount;
        paramBalanceCurrent.innerText = tel.balanceCurrent.toFixed(2);
        
        renderCells(tel.cells, sett);

        if (document.activeElement !== switchCharge) switchCharge.checked = tel.switches.charge;
        if (document.activeElement !== switchDischarge) switchDischarge.checked = tel.switches.discharge;
        if (document.activeElement !== switchBalance) switchBalance.checked = tel.switches.balance;

        setTempMos.innerText = `${tel.temperatures.mosfet.toFixed(1)} °C`;
        setTempT1.innerText = `${tel.temperatures.temp1.toFixed(1)} °C`;
        setTempT2.innerText = `${tel.temperatures.temp2.toFixed(1)} °C`;
    }

    if (sett && !isSettingsDirty) {
        syncSettingsInputs(sett);
    }
}

// ----------------------------------------------------
// CELLS GRID RENDER ENGINE
// ----------------------------------------------------
function renderCells(cells, settings) {
    if (!cells || cells.length === 0) return;

    if (cells.length !== currentCellCount) {
        currentCellCount = cells.length;
        cellsGrid.innerHTML = '';
        
        cells.forEach(cell => {
            const div = document.createElement('div');
            div.className = 'lcd-cell-box';
            div.id = `cell-box-${cell.index}`;
            div.innerHTML = `
                <span class="lcd-label-small">C${String(cell.index).padStart(2, '0')}</span>
                <span class="cell-v-num" id="cell-v-${cell.index}">0.000V</span>
                <span class="cell-bal-badge hidden" id="cell-bal-${cell.index}"></span>
            `;
            cellsGrid.appendChild(div);
        });
    }

    let minVolt = 99.0;
    let maxVolt = 0.0;
    let minCellIdx = 1;
    let maxCellIdx = 1;

    cells.forEach(cell => {
        if (cell.voltage < minVolt) {
            minVolt = cell.voltage;
            minCellIdx = cell.index;
        }
        if (cell.voltage > maxVolt) {
            maxVolt = cell.voltage;
            maxCellIdx = cell.index;
        }
    });

    const delta = maxVolt - minVolt;
    paramDelta.innerText = `${delta.toFixed(3)} V`;

    infoMaxCell.innerText = `${maxVolt.toFixed(3)}V (#${maxCellIdx})`;
    infoMinCell.innerText = `${minVolt.toFixed(3)}V (#${minCellIdx})`;

    cells.forEach(cell => {
        const box = document.getElementById(`cell-box-${cell.index}`);
        const text = document.getElementById(`cell-v-${cell.index}`);
        const badge = document.getElementById(`cell-bal-${cell.index}`);

        if (!box || !text) return;

        text.innerText = `${cell.voltage.toFixed(3)}V`;
        box.className = 'lcd-cell-box';
        
        if (cell.index === maxCellIdx) {
            box.classList.add('volt-highest');
        } else if (cell.index === minCellIdx) {
            box.classList.add('volt-lowest');
        }

        if (cell.balancing === 'charge') {
            badge.innerText = 'Bal+';
            badge.className = 'cell-bal-badge bal-in';
        } else if (cell.balancing === 'discharge') {
            badge.innerText = 'Bal-';
            badge.className = 'cell-bal-badge bal-out';
        } else {
            badge.className = 'cell-bal-badge hidden';
        }
    });
}

// ----------------------------------------------------
// SYNC CONFIGURATION SETTINGS
// ----------------------------------------------------
function syncSettingsInputs(sett) {
    document.getElementById('set-cell-count').value = sett.cellCount;
    document.getElementById('set-nominal-capacity').value = sett.nominalCapacity;
    document.getElementById('set-cell-ov').value = sett.cellOvervoltageProtect.toFixed(3);
    document.getElementById('set-cell-uv').value = sett.cellUndervoltageProtect.toFixed(3);
    document.getElementById('set-max-charge').value = Math.round(sett.maxChargeCurrent);
    document.getElementById('set-max-discharge').value = Math.round(sett.maxDischargeCurrent);
    document.getElementById('set-balance-start').value = sett.balanceStartVoltage.toFixed(2);
    document.getElementById('set-balance-diff').value = sett.balanceTriggerDiff.toFixed(3);
    document.getElementById('set-balance-current').value = sett.maxBalanceCurrent.toFixed(1);
    
    isSettingsDirty = false;
    settingsSync.className = "settings-sync-badge";
    settingsSync.innerHTML = `<i data-lucide="check-circle-2"></i> Sinkron`;
}

const settingsInputs = document.querySelectorAll('.settings-pane-params input');
settingsInputs.forEach(input => {
    input.addEventListener('input', () => {
        isSettingsDirty = true;
        settingsSync.className = "settings-sync-badge dirty";
        settingsSync.innerHTML = `<i data-lucide="alert-circle"></i> Parameter Diedit`;
        lucide.createIcons();
    });
});

// ----------------------------------------------------
// TOAST ALERTS CENTRE
// ----------------------------------------------------
let toastTimeout;
function showToast(message, type = 'info') {
    clearTimeout(toastTimeout);
    
    toastMessage.innerText = message;
    toast.className = 'lcd-toast active';
    
    if (type === 'error') {
        toast.classList.add('error-toast');
        toastIcon.setAttribute('data-lucide', 'shield-x');
    } else if (type === 'success') {
        toast.classList.add('success-toast');
        toastIcon.setAttribute('data-lucide', 'check-circle-2');
    } else {
        toastIcon.setAttribute('data-lucide', 'info');
    }

    lucide.createIcons();

    toastTimeout = setTimeout(() => {
        toast.classList.remove('active', 'error-toast', 'success-toast');
    }, 3500);
}

// ====================================================
// COMPATIBLE CHARACTERISTIC WRITE WRAPPER
// ====================================================
function writeCharacteristic(characteristic, value) {
    if (!characteristic) return Promise.reject(new Error("Karakteristik tidak aktif"));
    
    if (characteristic.writeValueWithoutResponse) {
        return characteristic.writeValueWithoutResponse(value)
            .catch(err => {
                console.warn("writeValueWithoutResponse failed, trying writeValueWithResponse...", err);
                if (characteristic.writeValueWithResponse) {
                    return characteristic.writeValueWithResponse(value);
                }
                return characteristic.writeValue(value);
            });
    } else if (characteristic.writeValueWithResponse) {
        return characteristic.writeValueWithResponse(value);
    } else {
        return characteristic.writeValue(value);
    }
}

// ====================================================
// DIRECT BROWSER WEB BLUETOOTH CLIENT
// ====================================================
let debugPacketCount = 0;
function connectWebBle() {
    if (bleConnectionStatus === 'connecting' || bleConnectionStatus === 'connected') {
        disconnectWebBle();
        return;
    }

    console.log("Starting Web Bluetooth request...");
    bleConnectionStatus = 'connecting';
    updateUI(localBmsState);

    navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
            '0000ffe0-0000-1000-8000-00805f9b34fb', // Standard Service
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic NUS
            '0000ffe5-0000-1000-8000-00805f9b34fb'  // Alt JK Service
        ]
    })
    .then(device => {
        bleDevice = device;
        console.log("BLE Device selected:", device.name);
        showToast(`Menghubungkan ke ${device.name || 'Jikong BMS'}...`, "info");
        
        device.addEventListener('gattserverdisconnected', onBleDisconnected);
        return device.gatt.connect();
    })
    .then(server => {
        bleServer = server;
        console.log("GATT Connected. Resolving service...");
        
        return server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb')
            .catch(() => {
                console.log("Service ffe0 not found, trying Nordic NUS...");
                return server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
            })
            .catch(() => {
                console.log("Nordic NUS not found, trying Alt JK ffe5...");
                return server.getPrimaryService('0000ffe5-0000-1000-8000-00805f9b34fb');
            });
    })
    .then(service => {
        bleService = service;
        console.log("Service resolved. Finding characteristics...");

        if (service.uuid === '0000ffe0-0000-1000-8000-00805f9b34fb') {
            return service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb')
                .then(char => {
                    bleRxChar = char;
                    bleTxChar = char;
                });
        } else if (service.uuid === '6e400001-b5a3-f393-e0a9-e50e24dcca9e') {
            return service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e')
                .then(rxChar => {
                    bleRxChar = rxChar;
                    return service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
                })
                .then(txChar => {
                    bleTxChar = txChar;
                });
        } else {
            return service.getCharacteristic('0000ffe9-0000-1000-8000-00805f9b34fb')
                .then(char => {
                    bleRxChar = char;
                    bleTxChar = char;
                });
        }
    })
    .then(() => {
        console.log("Enabling data notification...");
        return bleRxChar.startNotifications();
    })
    .then(() => {
        console.log("Web BLE Connection Fully Configured!");
        bleRxChar.addEventListener('characteristicvaluechanged', onBleNotificationReceived);
        
        bleConnectionStatus = 'connected';
        localBmsState.connectionStatus = 'connected';
        localBmsState.connectedDevice = {
            name: bleDevice.name || 'Jikong BMS',
            address: bleDevice.id
        };
        
        showToast("Terhubung ke BMS! Mengirim auth...", "success");
        debugPacketCount = 0;
        atHeartbeatCount = 0;
        bmsProtocol = 'jk04';
        bleDataReady = false;
        jk04RxBuffer = new Uint8Array(0);

        // Step 1: Send auth with correct password '1234'
        setTimeout(() => sendBmsAuth('1234'), 300);
        
        // Step 2: After 1s, fetch settings (0x96) once to get cell count & capacity
        setTimeout(() => sendJk04Query(0x96), 1000);
        
        // Step 3: After 1.5s, start telemetry polling (0x97) every 1 second
        setTimeout(() => {
            bleQueryTimer = setInterval(sendBmsQuery, 1000);
            sendBmsQuery(); // immediate first poll
        }, 1500);
        
        // Automatically start Cloud Broadcast when Bluetooth connects!
        switchBroadcast.checked = true;
        initRemoteBinAndStartBroadcast();
        
        updateUI(localBmsState);
    })
    .catch(err => {
        console.error("GATT connection error:", err);
        showToast("Gagal menyambung: " + err.message, "error");
        disconnectWebBle();
    });
}

function onBleNotificationReceived(event) {
    let value = event.target.value;
    let chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    
    // Print every received BLE chunk to console for debugging
    const hex = Array.from(chunk).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    console.log(`[BLE RX] #${debugPacketCount + 1} | ${chunk.length} bytes`);
    console.log(`  HEX:   ${hex}`);
    console.log(`  ASCII: ${ascii}`);

    debugPacketCount++;
    if (debugPacketCount <= 15) {
        showToast(`RX #${debugPacketCount}: ${chunk.length}B [${hex.slice(0,30)}...]`, "success");
    }

    // Ignore AT keepalive heartbeat (41 54 0D 0A = 'AT\r\n')
    if (chunk[0] === 0x41 && chunk[1] === 0x54 && chunk[2] === 0x0D && chunk[3] === 0x0A
        && (chunk.length === 4 || chunk.every((b,i) => i % 4 < 4 && [0x41,0x54,0x0D,0x0A][i%4] === b))) {
        if (atHeartbeatCount === 0) console.log('[Heartbeat] AT keepalive. JK04 protocol active.');
        atHeartbeatCount++;
        return;
    }

    // Auth challenge: AA 55 90 EB (4 bytes) → BMS asking for password
    if (chunk.length === 4 &&
        chunk[0] === 0xAA && chunk[1] === 0x55 &&
        chunk[2] === 0x90 && chunk[3] === 0xEB) {
        console.log("[BLE Auth] BMS requested auth, resending password '1234'...");
        sendBmsAuth('1234');
        return;
    }

    // JK04 response: starts with 55 AA EB 90 (reversed response header)
    if (chunk[0] === 0x55 && chunk[1] === 0xAA &&
        chunk[2] === 0xEB && chunk[3] === 0x90) {
        // New response packet — reset accumulator and start fresh
        jk04RxBuffer = new Uint8Array(chunk.length);
        jk04RxBuffer.set(chunk);
        console.log(`[JK04 RX] New response started, type=0x${chunk[4].toString(16)}, got ${chunk.length} bytes`);
        processJk04Buffer();
        return;
    }

    // Continuation chunk for ongoing JK04 response
    if (jk04RxBuffer.length > 0) {
        const merged = new Uint8Array(jk04RxBuffer.length + chunk.length);
        merged.set(jk04RxBuffer);
        merged.set(chunk, jk04RxBuffer.length);
        jk04RxBuffer = merged;
        console.log(`[JK04 RX] Accumulated ${jk04RxBuffer.length} bytes total`);
        processJk04Buffer();
        return;
    }

    // Fallback: try JK02 4E 57 style parser
    handleIncomingBleData(chunk);
}

// Process accumulated JK04 response buffer when we think we have a full frame
function processJk04Buffer() {
    if (jk04RxBuffer.length < 5) return;

    const frameType = jk04RxBuffer[4];
    // Heuristic: response is complete when next start marker (55 AA EB 90) appears
    // or when no new data comes for a period.
    // For now: try to decode if we have at least 150 bytes (one full chunk)
    if (jk04RxBuffer.length >= 150) {
        console.log(`[JK04] Processing ${jk04RxBuffer.length} bytes, frameType=0x${frameType.toString(16)}`);
        decodeJk04Frame(jk04RxBuffer, frameType);
        jk04RxBuffer = new Uint8Array(0);
    }
} // end processJk04Buffer

// =====================================================
// JK04 FRAME DECODER
// Response header: 55 AA EB 90 [type] [data...]
// type 0x01 = settings (from 0x96 command)
// type 0x02 = telemetry / cell info (from 0x97 command)
// type 0x03 = device info (serial, firmware, password)
// =====================================================
function decodeJk04Frame(data, frameType) {
    const hex32 = Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    console.log(`[JK04 Decoder] type=0x${frameType.toString(16)}, total=${data.length} bytes`);
    console.log(`[JK04 Decoder] First 32B: ${hex32}`);

    const t = localBmsState.telemetry;
    const s = localBmsState.settings;

    if (frameType === 0x01) {
        // ── SETTINGS FRAME (0x96 response) ──────────────────
        // Fields are 4-byte little-endian uint32, starting at byte[5]
        // Known offsets (confirmed from data analysis vs JK app):
        // [5..8]    = cell overvoltage recovery (mV)
        // [9..12]   = cell undervoltage protect (mV)
        // [13..16]  = cell undervoltage recovery (mV)
        // [17..20]  = cell overvoltage protect (mV)
        // [113..116]= cell count
        // [129..132]= nominal capacity (mAh)
        function read32(off) {
            if (off + 3 >= data.length) return 0;
            return data[off] | (data[off+1]<<8) | (data[off+2]<<16) | (data[off+3]<<24);
        }
        const cellOVP       = read32(17) ; // mV
        const cellUVP       = read32(9)  ; // mV
        const cellUVPRec    = read32(13) ; // mV
        const cellOVPRec    = read32(5)  ; // mV
        const cellCount     = read32(113);
        const nomCapMah     = read32(129); // mAh

        console.log(`[JK04 Settings] cellCount=${cellCount}, nomCap=${nomCapMah}mAh, OVP=${cellOVP}mV, UVP=${cellUVP}mV`);

        if (cellCount > 0 && cellCount <= 32) s.cellCount = cellCount;
        if (nomCapMah > 0) s.nominalCapacity = nomCapMah / 1000; // Ah
        if (cellOVP > 0)   s.cellOvervoltageProtect = cellOVP / 1000;
        if (cellUVP > 0)   s.cellUndervoltageProtect = cellUVP / 1000;
        if (cellOVPRec > 0) s.cellOvervoltageRecovery = cellOVPRec / 1000;
        if (cellUVPRec > 0) s.cellUndervoltageRecovery = cellUVPRec / 1000;

        showToast(`Settings: ${cellCount} cells, ${(nomCapMah/1000).toFixed(1)}Ah`, "info");
        updateUI(localBmsState);

    } else if (frameType === 0x02) {
        // ── TELEMETRY FRAME (0x97 response) ────────────────
        // Based on JK04 protocol: 4-byte LE values
        // Log ALL fields for analysis, then parse what we can
        console.log('[JK04 Telemetry] Full hex dump:');
        const fullHex = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
        console.log(fullHex);
        
        // Try to parse: cell voltages start at byte[5], each 4 bytes LE in mV
        // Total voltage, current, SOC follow after cell data
        const cellCount = s.cellCount || 12;
        const cells = [];
        let off = 5;
        for (let i = 0; i < cellCount && off + 3 < data.length; i++) {
            const mv = data[off] | (data[off+1]<<8) | (data[off+2]<<16) | (data[off+3]<<24);
            if (mv > 2000 && mv < 4500) { // sane cell voltage range (mV)
                cells.push({ index: i+1, voltage: mv/1000, balancing: false });
            }
            off += 4;
        }
        if (cells.length > 0) {
            t.cells = cells;
            console.log(`[JK04 Telemetry] Parsed ${cells.length} cells. First: ${cells[0].voltage}V`);
        }

        // Look for total voltage, current, SOC after cells
        // (offsets TBD from next console dump — log raw for now)
        bleDataReady = cells.length > 0;
        if (bleDataReady) updateUI(localBmsState);

    } else if (frameType === 0x03) {
        // ── DEVICE INFO (serial, model, firmware) ──────────
        // Already visible in ASCII from logs, just extract password
        const asciiSlice = Array.from(data.slice(5, 80))
            .map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.')
            .join('');
        console.log('[JK04 DevInfo] ASCII:', asciiSlice);

    } else {
        // Unknown frame type — dump full hex for analysis
        console.log(`[JK04 Unknown type=0x${frameType.toString(16)}] Full hex:`);
        const dump = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
        console.log(dump);
    }
}

// Parse AT command text responses from BMS (legacy, kept for compat)
function parseAtResponse(text) {
    console.log('[AT Parser] Received:', text);
    const pairs = text.split(/[,;\n]/);
    let updated = false;
    pairs.forEach(pair => {
        const [k, v] = pair.split('=').map(s => s.trim());
        if (!k || !v) return;
        const num = parseFloat(v);
        switch (k.toUpperCase()) {
            case 'VOLTAGE': case 'TOTALVOL': case 'BAT_VOL':
                localBmsState.telemetry.totalVoltage = num; updated = true; break;
            case 'CURRENT': case 'BAT_CUR':
                localBmsState.telemetry.current = num; updated = true; break;
            case 'SOC': case 'RSOC':
                localBmsState.telemetry.soc = Math.round(num); updated = true; break;
            case 'CAPACITY': case 'REMAIN_CAP':
                localBmsState.telemetry.remainingCapacity = num; updated = true; break;
            case 'TEMP1': case 'MOS_TEMP':
                localBmsState.telemetry.temperatures.mosfet = num; updated = true; break;
        }
    });
    if (updated) {
        bleDataReady = true;
        localBmsState.telemetry.power = localBmsState.telemetry.totalVoltage * localBmsState.telemetry.current;
        updateUI(localBmsState);
    }
}


function onBleDisconnected() {
    console.warn("BLE Device disconnected.");
    showToast("Bluetooth terputus", "error");
    disconnectWebBle();
}

function disconnectWebBle() {
    if (bleQueryTimer) {
        clearInterval(bleQueryTimer);
        bleQueryTimer = null;
    }
    if (bleRxChar) {
        try {
            bleRxChar.removeEventListener('characteristicvaluechanged', onBleNotificationReceived);
        } catch(e) {}
        bleRxChar = null;
    }
    if (bleDevice) {
        try {
            bleDevice.removeEventListener('gattserverdisconnected', onBleDisconnected);
            if (bleDevice.gatt.connected) {
                bleDevice.gatt.disconnect();
            }
        } catch(e) {}
        bleDevice = null;
    }
    bleServer = null;
    bleService = null;
    bleTxChar = null;
    bleConnectionStatus = 'disconnected';
    localBmsState.connectionStatus = 'disconnected';
    localBmsState.connectedDevice = null;
    updateUI(localBmsState);
}

// ====================================================
// JKBMS PASSWORD AUTH (AA 55 90 EB protocol)
// Some JKBMS units require password auth before responding to queries.
// The BMS sends 4 bytes (AA 55 90 EB) on connect to indicate auth is needed.
// ====================================================
function sendBmsAuth(password = '1234') {
    if (!bleTxChar) return;

    // Password frame using JK04 format: AA 55 90 EB + [pwLen] + [pw bytes] + [checksum]
    const pwBytes = Array.from(password).map(c => c.charCodeAt(0));
    const frame = new Uint8Array(20);
    frame[0] = 0xAA;
    frame[1] = 0x55;
    frame[2] = 0x90;
    frame[3] = 0xEB;
    frame[4] = pwBytes.length;
    for (let i = 0; i < pwBytes.length && i < 14; i++) {
        frame[5 + i] = pwBytes[i];
    }
    // Checksum = sum of first 5 bytes & 0xFF (confirmed from protocol analysis)
    let checksum = (frame[0] + frame[1] + frame[2] + frame[3] + frame[4]) & 0xFF;
    frame[19] = checksum;

    showToast(`Mengirim password '${password}' ke BMS...`, "info");
    console.log("[BLE Auth] Sending password frame:", Array.from(frame).map(b => b.toString(16).padStart(2,'0')).join(' '));

    writeCharacteristic(bleTxChar, frame)
        .then(() => {
            console.log("[BLE Auth] Password sent OK.");
        })
        .catch(err => {
            console.error("[BLE Auth] Auth failed:", err);
            showToast("Auth gagal: " + err.message, "error");
        });
}

// BMS protocol detection state
let bmsProtocol = 'jk04'; // default to JK04
let atHeartbeatCount = 0;
let jk04RxBuffer = new Uint8Array(0); // accumulate multi-chunk JK04 responses
let jk04ExpectedLen = 0;

function sendBmsQuery() {
    if (!bleTxChar) return;
    // JK04 0x97 = telemetry command (cell voltages, current, SOC, temperature)
    sendJk04Query(0x97);
}

// AT command mode (text protocol)
function sendAtCommand(cmd) {
    const text = cmd + '\r\n';
    const encoded = new TextEncoder().encode(text);
    console.log(`[AT CMD] Sending: ${text.trim()}`);
    writeCharacteristic(bleTxChar, encoded)
        .catch(err => console.error('[AT CMD] Error:', err));
}

// Send JK04 command: AA 55 90 EB [cmd] 00 03 00...00 [cksum]
// Checksum = (AA+55+90+EB+cmd) & 0xFF  (verified from protocol docs)
function sendJk04Query(cmd = 0x97) {
    const frame = new Uint8Array(21);
    frame[0] = 0xAA; frame[1] = 0x55; frame[2] = 0x90; frame[3] = 0xEB;
    frame[4] = cmd;       // 0x97 = telemetry, 0x96 = settings
    frame[5] = 0x00;
    frame[6] = 0x03;      // source = BLE
    // bytes 7-19 = 0x00 (padding)
    const cksum = (0xAA + 0x55 + 0x90 + 0xEB + cmd) & 0xFF;
    frame[20] = cksum;
    const label = cmd === 0x97 ? 'telemetry(0x97)' : 'settings(0x96)';
    console.log(`[JK04] Sending ${label}:`, Array.from(frame).map(b => b.toString(16).padStart(2,'0')).join(' '));
    writeCharacteristic(bleTxChar, frame)
        .catch(err => console.error('[JK04] Error:', err));
}

// JK02 binary protocol query (4E 57 header)
function sendJk02Query() {
    let cmd = new Uint8Array(18);
    cmd[0] = 0x4E; cmd[1] = 0x57;
    cmd[2] = 0x00; cmd[3] = 0x16;
    cmd[8] = 0x06;
    cmd[9] = 0x03;

    let sum = 0;
    for (let i = 0; i < cmd.length; i++) sum += cmd[i];

    let finalPacket = new Uint8Array(22);
    finalPacket.set(cmd);
    finalPacket[18] = (sum >> 24) & 0xff;
    finalPacket[19] = (sum >> 16) & 0xff;
    finalPacket[20] = (sum >> 8) & 0xff;
    finalPacket[21] = sum & 0xff;

    writeCharacteristic(bleTxChar, finalPacket)
        .catch(err => console.error("Error writing JK02 query:", err));
}

function writeBmsSetting(registerId, value, size = 1) {
    if (localBmsState.mode === 'simulated') return;

    if (!bleTxChar) {
        showToast("Bluetooth tidak terhubung", "error");
        return;
    }

    let payload = new Uint8Array(2 + size);
    payload[0] = registerId;
    payload[1] = size;

    if (size === 1) {
        payload[2] = value;
    } else if (size === 2) {
        payload[2] = (value >> 8) & 0xff;
        payload[3] = value & 0xff;
    } else if (size === 4) {
        payload[2] = (value >> 24) & 0xff;
        payload[3] = (value >> 16) & 0xff;
        payload[4] = (value >> 8) & 0xff;
        payload[5] = value & 0xff;
    }

    let basePacket = new Uint8Array(10 + payload.length);
    basePacket[0] = 0x4E;
    basePacket[1] = 0x57;
    let totalLen = basePacket.length + 4;
    basePacket[2] = (totalLen >> 8) & 0xff;
    basePacket[3] = totalLen & 0xff;
    basePacket[8] = 0x02; // Write setting command
    basePacket[9] = 0x03; // Source PC
    basePacket.set(payload, 10);

    let sum = 0;
    for (let i = 0; i < basePacket.length; i++) {
        sum += basePacket[i];
    }

    let finalPacket = new Uint8Array(basePacket.length + 4);
    finalPacket.set(basePacket);
    finalPacket[basePacket.length] = (sum >> 24) & 0xff;
    finalPacket[basePacket.length + 1] = (sum >> 16) & 0xff;
    finalPacket[basePacket.length + 2] = (sum >> 8) & 0xff;
    finalPacket[basePacket.length + 3] = sum & 0xff;

    writeCharacteristic(bleTxChar, finalPacket)
        .then(() => console.log("Successfully wrote register:", registerId))
        .catch(err => showToast("Gagal menulis setelan ke BMS: " + err.message, "error"));
}

function handleIncomingBleData(chunk) {
    let nextBuf = new Uint8Array(rxBuffer.length + chunk.length);
    nextBuf.set(rxBuffer);
    nextBuf.set(chunk, rxBuffer.length);
    rxBuffer = nextBuf;

    // Check for JK04 response header: AA 55 90 EB
    if (rxBuffer.length >= 4 &&
        rxBuffer[0] === 0xAA && rxBuffer[1] === 0x55 &&
        rxBuffer[2] === 0x90 && rxBuffer[3] === 0xEB) {
        console.log(`[JK04] Buffer has ${rxBuffer.length} bytes with AA55 header`);
        // JK04: wait until we have enough data (min ~150 bytes for cell data)
        if (rxBuffer.length >= 150 || (rxBuffer.length > 4 && rxBuffer.length < 150)) {
            console.log(`[JK04] Attempting JK04 decode of ${rxBuffer.length} bytes`);
            decodeJk04Packet(rxBuffer);
            rxBuffer = new Uint8Array(0);
        }
        return;
    }

    let headerIdx = -1;
    for (let i = 0; i < rxBuffer.length - 1; i++) {
        if (rxBuffer[i] === 0x4E && rxBuffer[i+1] === 0x57) {
            headerIdx = i;
            break;
        }
    }

    if (headerIdx === -1) {
        if (rxBuffer.length > 1000) rxBuffer = new Uint8Array(0);
        return;
    }

    if (headerIdx > 0) {
        rxBuffer = rxBuffer.slice(headerIdx);
    }

    if (rxBuffer.length < 4) return;

    let packetLength = (rxBuffer[2] << 8) | rxBuffer[3];
    if (rxBuffer.length < packetLength) return;

    let packet = rxBuffer.slice(0, packetLength);
    rxBuffer = rxBuffer.slice(packetLength);

    if (packetLength > 8) {
        let dataPart = packet.slice(0, packetLength - 4);
        let rxChecksum = ((packet[packetLength-4] << 24) >>> 0) + (packet[packetLength-3] << 16) + (packet[packetLength-2] << 8) + packet[packetLength-1];

        let calculatedChecksum = 0;
        for (let i = 0; i < dataPart.length; i++) {
            calculatedChecksum += dataPart[i];
        }

        if (calculatedChecksum === rxChecksum) {
            decodeJkBmsPacket(dataPart);
        } else {
            showToast("Error Checksum BLE: calc=" + calculatedChecksum + " rx=" + rxChecksum, "error");
            console.warn(`[BLE Parser] Checksum error! calc=${calculatedChecksum}, rx=${rxChecksum}`);
        }
    }

    if (rxBuffer.length >= 4) {
        handleIncomingBleData(new Uint8Array(0));
    }
}

function decodeJkBmsPacket(data) {
    let cmdType = data[8];
    console.log(`[BLE Parser] decodeJkBmsPacket called, cmdType=0x${cmdType.toString(16).toUpperCase()}, length=${data.length}`);
    if (cmdType !== 0x06) {
        console.warn(`[BLE Parser] Ignoring non-status packet cmdType=0x${cmdType.toString(16).toUpperCase()}`);
        return;
    }

    let offset = 11;
    let length = data.length;
    let t = localBmsState.telemetry;
    let s = localBmsState.settings;

    let cellsList = [];

    while (offset < length) {
        let tag = data[offset];
        offset += 1;

        switch (tag) {
            case 0x79: {
                let len = data[offset];
                offset += 1;
                let cellCount = len / 3;
                for (let i = 0; i < cellCount; i++) {
                    let idx = data[offset + i*3];
                    let volt = (data[offset + i*3 + 1] << 8) | data[offset + i*3 + 2];
                    cellsList.push({
                        index: idx,
                        voltage: volt / 1000,
                        balancing: false
                    });
                }
                offset += len;
                break;
            }
            case 0x80: {
                t.temperatures.mosfet = readInt16BE(data, offset);
                offset += 2;
                break;
            }
            case 0x81: {
                t.temperatures.temp1 = readInt16BE(data, offset);
                offset += 2;
                break;
            }
            case 0x82: {
                t.temperatures.temp2 = readInt16BE(data, offset);
                offset += 2;
                break;
            }
            case 0x83: {
                t.totalVoltage = readUInt32BE(data, offset) / 100;
                offset += 4;
                break;
            }
            case 0x84: {
                t.current = readInt32BE(data, offset) / 100;
                t.power = t.totalVoltage * t.current;
                offset += 4;
                break;
            }
            case 0x85: {
                let val = readUInt32BE(data, offset);
                t.remainingCapacity = val > 10000 ? val / 1000 : val / 100;
                offset += 4;
                break;
            }
            case 0x87: {
                t.cycleCount = readUInt16BE(data, offset);
                offset += 2;
                break;
            }
            case 0x89: {
                let val = readUInt32BE(data, offset);
                s.nominalCapacity = val > 10000 ? val / 1000 : val / 100;
                t.totalCapacity = s.nominalCapacity;
                offset += 4;
                break;
            }
            case 0x8A: {
                s.cellCount = readUInt16BE(data, offset);
                offset += 2;
                break;
            }
            case 0x8B: {
                let warningFlags = readUInt16BE(data, offset);
                parseWarningFlags(warningFlags);
                offset += 2;
                break;
            }
            case 0x8C: {
                let statusFlags = data[offset];
                t.switches.charge = (statusFlags & 0x01) !== 0;
                t.switches.discharge = (statusFlags & 0x02) !== 0;
                t.switches.balance = (statusFlags & 0x04) !== 0;
                offset += 1;
                break;
            }
            case 0x90: {
                s.cellOvervoltageProtect = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x91: {
                s.cellUndervoltageProtect = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x92: {
                s.cellOvervoltageRecovery = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x93: {
                s.cellUndervoltageRecovery = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x94: {
                s.maxChargeCurrent = readUInt16BE(data, offset) / 10;
                offset += 2;
                break;
            }
            case 0x95: {
                s.maxDischargeCurrent = readUInt16BE(data, offset) / 10;
                offset += 2;
                break;
            }
            case 0x96: {
                s.balanceStartVoltage = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x97: {
                s.balanceTriggerDiff = readUInt16BE(data, offset) / 1000;
                offset += 2;
                break;
            }
            case 0x98: {
                s.maxBalanceCurrent = readUInt16BE(data, offset) / 10;
                offset += 2;
                break;
            }
            case 0x9D: {
                t.switches.charge = data[offset] === 1;
                offset += 1;
                break;
            }
            case 0x9E: {
                t.switches.discharge = data[offset] === 1;
                offset += 1;
                break;
            }
            case 0x9F: {
                t.switches.balance = data[offset] === 1;
                offset += 1;
                break;
            }
            default: {
                if (tag >= 0x90 && tag <= 0x9B) offset += 2;
                else if (tag >= 0x9C && tag <= 0x9F) offset += 1;
                else if (tag === 0x86 || tag === 0x8E || tag === 0x8F) offset += 1;
                else if (tag === 0x88 || tag === 0x8C) offset += 1;
                else if (tag === 0x79) { offset += data[offset] + 1; }
                else { offset += 2; }
                break;
            }
        }
    }

    if (cellsList.length > 0) {
        cellsList.sort((a, b) => a.index - b.index);
        t.cells = cellsList;

        let minC = t.cells[0];
        let maxC = t.cells[0];
        t.cells.forEach(c => {
            if (c.voltage < minC.voltage) minC = c;
            if (c.voltage > maxC.voltage) maxC = c;
        });

        const diff = maxC.voltage - minC.voltage;
        if (t.switches.balance && diff > s.balanceTriggerDiff && maxC.voltage >= s.balanceStartVoltage) {
            t.balancersActive = true;
            maxC.balancing = 'discharge';
            minC.balancing = 'charge';
        }
    }

    t.soc = Math.round((t.remainingCapacity / s.nominalCapacity) * 100);
    if (t.soc > 100) t.soc = 100;
    
    bleDataReady = true; // Mark that we have real BLE data
    console.log(`[BLE Parser] ✅ Parse OK! Cells=${t.cells.length}, V=${t.totalVoltage}V, I=${t.current}A, SOC=${t.soc}%`);
    updateUI(localBmsState);
}

// ====================================================
// JK04 PROTOCOL DECODER (AA 55 90 EB response)
// Used by older JKBMS firmware
// ====================================================
function decodeJk04Packet(data) {
    console.log(`[JK04 Decoder] Parsing ${data.length} bytes`);
    const hex = Array.from(data.slice(0, 32)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    console.log(`[JK04 Decoder] Header bytes: ${hex}`);

    // JK04 response structure (approximate offsets, may vary):
    // [0..3]  = AA 55 90 EB (header)
    // [4]     = frame type / command echo (0x96 = cell info response)
    // [5]     = number of cells
    // [6..6+cells*2-1] = cell voltages, 2 bytes each (mV)
    // then: average voltage, delta, total voltage, current, temperature, remaining capacity, etc.

    if (data.length < 6) {
        console.warn('[JK04 Decoder] Too short, skipping');
        return;
    }

    const frameType = data[4];
    const cellCount = data[5];
    console.log(`[JK04 Decoder] frameType=0x${frameType.toString(16)}, cellCount=${cellCount}`);

    const t = localBmsState.telemetry;
    const s = localBmsState.settings;

    if (cellCount > 0 && cellCount <= 32 && data.length >= 6 + cellCount * 2) {
        // Parse cell voltages
        const cells = [];
        for (let i = 0; i < cellCount; i++) {
            const offset = 6 + i * 2;
            const mv = (data[offset] << 8) | data[offset + 1];
            cells.push({ index: i + 1, voltage: mv / 1000, balancing: false });
        }
        t.cells = cells;
        s.cellCount = cellCount;

        // After cells: average(2), delta(2), balance_bitmask(4), total_voltage(4), current(4), temp_mosfet(2), temp1(2), remaining_cap(4), nominal_cap(4), cycle(4), soc(2)
        let off = 6 + cellCount * 2;
        if (off + 2 <= data.length) { off += 2; } // skip avg volt
        if (off + 2 <= data.length) { off += 2; } // skip delta
        if (off + 4 <= data.length) { off += 4; } // skip balance bitmask
        if (off + 4 <= data.length) {
            t.totalVoltage = readUInt32BE(data, off) / 1000;
            off += 4;
        }
        if (off + 4 <= data.length) {
            // Current: signed 32-bit, positive=charge, negative=discharge in JK04
            let rawCurrent = readInt32BE(data, off);
            t.current = rawCurrent / 1000;
            off += 4;
        }
        if (off + 2 <= data.length) {
            t.temperatures.mosfet = readInt16BE(data, off) / 10;
            off += 2;
        }
        if (off + 2 <= data.length) {
            t.temperatures.temp1 = readInt16BE(data, off) / 10;
            off += 2;
        }
        if (off + 4 <= data.length) {
            t.remainingCapacity = readUInt32BE(data, off) / 1000;
            off += 4;
        }
        if (off + 4 <= data.length) {
            s.nominalCapacity = readUInt32BE(data, off) / 1000;
            off += 4;
        }

        t.power = +(t.totalVoltage * t.current).toFixed(1);
        t.soc = Math.min(100, Math.round((t.remainingCapacity / s.nominalCapacity) * 100));

        bleDataReady = true;
        console.log(`[JK04 Decoder] ✅ Cells=${t.cells.length}, V=${t.totalVoltage}V, I=${t.current}A, SOC=${t.soc}%`);
        updateUI(localBmsState);
    } else {
        console.warn(`[JK04 Decoder] Unexpected cellCount=${cellCount} or too short (${data.length} bytes). Raw dump below:`);
        const fullHex = Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' ');
        console.log('[JK04 Raw]', fullHex);
    }
}

// Helpers for buffer parsing
function readUInt16BE(arr, offset) {
    return (arr[offset] << 8) | arr[offset + 1];
}
function readInt16BE(arr, offset) {
    let val = (arr[offset] << 8) | arr[offset + 1];
    return val > 32767 ? val - 65536 : val;
}
function readUInt32BE(arr, offset) {
    return ((arr[offset] << 24) >>> 0) + (arr[offset + 1] << 16) + (arr[offset + 2] << 8) + arr[offset + 3];
}
function readInt32BE(arr, offset) {
    return (arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3];
}

function parseWarningFlags(flags) {
    const warnings = [];
    if (flags & (1 << 0)) warnings.push("Low Single Cell Voltage Protection");
    if (flags & (1 << 1)) warnings.push("Overpack Voltage Protection");
    if (flags & (1 << 2)) warnings.push("Underpack Voltage Protection");
    if (flags & (1 << 3)) warnings.push("Charge Overtemp Protection");
    if (flags & (1 << 4)) warnings.push("Charge Low Temp Protection");
    if (flags & (1 << 5)) warnings.push("Discharge Overtemp Protection");
    if (flags & (1 << 6)) warnings.push("Discharge Low Temp Protection");
    if (flags & (1 << 7)) warnings.push("Charge Overcurrent Protection");
    if (flags & (1 << 8)) warnings.push("Discharge Overcurrent Protection");
    if (flags & (1 << 9)) warnings.push("Short Circuit Protection");
    if (flags & (1 << 10)) warnings.push("MOSFET Overtemp Protection");
    if (flags & (1 << 11)) warnings.push("Cell Voltage Imbalance Protection");
    
    localBmsState.telemetry.warnings = warnings;
}

// ====================================================
// STANDALONE LOCAL SIMULATOR
// ====================================================
function startLocalSimulator() {
    if (localSimInterval) clearInterval(localSimInterval);
    
    localSimInterval = setInterval(() => {
        if (localBmsState.mode !== 'simulated') return;
        
        const t = localBmsState.telemetry;
        const s = localBmsState.settings;

        if (t.switches.charge && t.switches.discharge) {
            if (t.soc >= 100) localSimDirection = -1;
            else if (t.soc <= 15) localSimDirection = 1;
            t.current = localSimDirection * (localSimCurrentBase + (Math.random() * 2 - 1));
        } else if (t.switches.charge && !t.switches.discharge) {
            localSimDirection = 1;
            t.current = t.soc < 100 ? localSimCurrentBase + Math.random() : 0;
        } else if (!t.switches.charge && t.switches.discharge) {
            localSimDirection = -1;
            t.current = -(localSimCurrentBase + Math.random());
        } else {
            localSimDirection = 0;
            t.current = 0.0;
        }

        if (t.cells.length !== s.cellCount) {
            t.cells = Array.from({ length: s.cellCount }, (_, i) => ({
                index: i + 1,
                voltage: 3.28 + (Math.random() * 0.04),
                balancing: false
            }));
        }

        const irDrop = t.current * 0.0015;
        t.cells.forEach(cell => {
            let voltageDelta = (t.current / s.nominalCapacity) * 0.005;
            if (cell.voltage > 3.42 && t.current > 0) voltageDelta *= (1 + (cell.voltage - 3.42) * 15);
            if (cell.voltage < 3.1 && t.current < 0) voltageDelta *= (1 + (3.1 - cell.voltage) * 8);

            cell.voltage += voltageDelta;
            if (cell.voltage > 3.8) cell.voltage = 3.8;
            if (cell.voltage < 2.0) cell.voltage = 2.0;
            cell.balancing = false;
        });

        let minCell = t.cells[0];
        let maxCell = t.cells[0];
        t.cells.forEach(c => {
            if (c.voltage < minCell.voltage) minCell = c;
            if (c.voltage > maxCell.voltage) maxCell = c;
        });

        const diff = maxCell.voltage - minCell.voltage;
        t.balancersActive = false;
        t.balanceCurrent = 0.0;

        if (t.switches.balance && diff > s.balanceTriggerDiff && maxCell.voltage >= s.balanceStartVoltage) {
            t.balancersActive = true;
            t.balanceCurrent = Math.min(s.maxBalanceCurrent, (diff * 20));
            const balanceTransferRate = 0.0003 * t.balanceCurrent;
            maxCell.voltage -= balanceTransferRate;
            minCell.voltage += balanceTransferRate;
            maxCell.balancing = 'discharge';
            minCell.balancing = 'charge';
        }

        t.totalVoltage = t.cells.reduce((sum, c) => sum + c.voltage, 0) + (irDrop * s.cellCount);
        t.power = t.totalVoltage * t.current;
        t.remainingCapacity += (t.current / 3600);
        if (t.remainingCapacity > s.nominalCapacity) t.remainingCapacity = s.nominalCapacity;
        if (t.remainingCapacity < 0) t.remainingCapacity = 0;
        t.soc = Math.round((t.remainingCapacity / s.nominalCapacity) * 100);

        const currentSquared = t.current * t.current;
        t.temperatures.mosfet += ((25.0 + currentSquared * 0.0005) - t.temperatures.mosfet) * 0.05;
        t.temperatures.temp1 += ((25.0 + Math.sin(Date.now() / 60000) * 2) - t.temperatures.temp1) * 0.01;
        t.temperatures.temp2 += ((26.0 + Math.cos(Date.now() / 80000) * 1.5) - t.temperatures.temp2) * 0.01;

        const newWarnings = [];
        t.cells.forEach(c => {
            if (c.voltage >= s.cellOvervoltageProtect) {
                newWarnings.push(`Cell ${c.index} Overvoltage (>= ${s.cellOvervoltageProtect}V)`);
                t.switches.charge = false;
            }
            if (c.voltage <= s.cellUndervoltageProtect) {
                newWarnings.push(`Cell ${c.index} Undervoltage (<= ${s.cellUndervoltageProtect}V)`);
                t.switches.discharge = false;
            }
        });
        t.warnings = newWarnings;

        updateUI(localBmsState);
    }, 1000);
}

function stopLocalSimulator() {
    if (localSimInterval) {
        clearInterval(localSimInterval);
        localSimInterval = null;
    }
}

// ====================================================
// CLOUD REMOTE SYNCING ENGINE (npoint.io)
// ====================================================
const HARDCODED_REMOTE_KEY = '0d6013fe3fa362ab0388';

function initRemoteBinAndStartBroadcast() {
    startBroadcasting(HARDCODED_REMOTE_KEY);
}

function startBroadcasting(binId) {
    statusKeyDisplay.innerText = `KEY: ${binId}`;
    statusKeyDisplay.classList.remove('hidden');
    
    if (broadcastTimer) clearInterval(broadcastTimer);
    
    broadcastTimer = setInterval(() => {
        if (!switchBroadcast.checked || bleConnectionStatus !== 'connected') {
            stopBroadcasting();
            return;
        }
        
        // Only upload to cloud when REAL BLE data has been successfully parsed
        if (!bleDataReady) {
            console.log("[Cloud] Waiting for real BLE data before uploading...");
            return;
        }
        
        const payload = JSON.stringify(localBmsState);
        console.log(`[Cloud] Uploading real BLE data to npoint.io (${localBmsState.telemetry.cells.length} cells, ${localBmsState.telemetry.totalVoltage}V)`);
        fetch(`https://api.npoint.io/${binId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        })
        .then(res => res.json())
        .then(() => console.log("[Cloud] ✅ Upload sukses!"))
        .catch(err => console.error("[Cloud] Upload gagal:", err));
    }, 5000);
}

function stopBroadcasting() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }
    statusKeyDisplay.classList.add('hidden');
    switchBroadcast.checked = false;
}

function startRemotePolling() {
    if (remotePollTimer) clearInterval(remotePollTimer);
    
    pollRemoteTelemetry(); // Poll immediately
    remotePollTimer = setInterval(pollRemoteTelemetry, 10000);
}

// Pre-fill remote key with user's custom npoint.io bin ID by default in startRemotePolling.
function stopRemotePolling() {
    if (remotePollTimer) {
        clearInterval(remotePollTimer);
        remotePollTimer = null;
    }
    bleConnectionStatus = 'disconnected';
    localBmsState.connectionStatus = 'disconnected';
    localBmsState.connectedDevice = null;
    updateUI(localBmsState);
}

function pollRemoteTelemetry() {
    // Append unique timestamp parameter and set cache: 'no-store' to bypass browser caching and get fresh real-time data
    fetch(`https://api.npoint.io/${HARDCODED_REMOTE_KEY}?t=${Date.now()}`, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error("Key tidak valid");
            return res.json();
        })
        .then(data => {
            if (data && data.telemetry) {
                localBmsState.telemetry = data.telemetry;
                if (data.settings) localBmsState.settings = data.settings;
                
                bleConnectionStatus = 'connected';
                localBmsState.connectionStatus = 'connected';
                localBmsState.connectedDevice = {
                    name: "Cloud Synced BMS",
                    address: "npoint.io/" + HARDCODED_REMOTE_KEY
                };
                statusText.innerText = "REMOTE DATA SYNCED";
                updateUI(localBmsState);
            }
        })
        .catch(err => {
            console.error("Remote poll error:", err);
            statusText.innerText = "KONEKSI CLOUD ERROR";
            statusDot.className = 'status-indicator-dot disconnected';
        });
}

// ----------------------------------------------------
// INTERACTIVE EVENT BINDINGS
// ----------------------------------------------------

modeSelect.addEventListener('change', () => {
    const val = modeSelect.value;
    localBmsState.mode = val;
    
    // Cleanup previous mode actions
    disconnectWebBle();
    stopLocalSimulator();
    stopRemotePolling();

    if (val === 'simulated') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_mode', value: 'simulated' }));
        } else {
            startLocalSimulator();
        }
    } else if (val === 'remote') {
        startRemotePolling();
    } else {
        // webble mode
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_mode', value: 'real' }));
        }
        connectWebBle();
    }
});

// Trigger poll immediately when Remote Key is edited
if (remoteKeyInput) {
    remoteKeyInput.addEventListener('input', () => {
        if (localBmsState.mode === 'remote') {
            pollRemoteTelemetry();
        }
    });
}

reconnectBtn.addEventListener('click', () => {
    if (localBmsState.mode === 'webble') {
        if (bleConnectionStatus === 'disconnected') {
            connectWebBle();
        } else {
            disconnectWebBle();
        }
    }
});

// Broadcast switch changed
switchBroadcast.addEventListener('change', () => {
    if (switchBroadcast.checked) {
        initRemoteBinAndStartBroadcast();
    } else {
        stopBroadcasting();
    }
});

switchCharge.addEventListener('change', () => {
    const val = switchCharge.checked;
    localBmsState.telemetry.switches.charge = val;
    
    if (localBmsState.mode === 'simulated') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_switch', switch: 'charge', value: val }));
        } else {
            updateUI(localBmsState);
        }
    } else if (localBmsState.mode === 'webble') {
        writeBmsSetting(0x9D, val ? 1 : 0, 1);
    }
    showToast(`Saklar CHG: ${val ? 'ON' : 'OFF'}`, 'info');
});

switchDischarge.addEventListener('change', () => {
    const val = switchDischarge.checked;
    localBmsState.telemetry.switches.discharge = val;
    
    if (localBmsState.mode === 'simulated') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_switch', switch: 'discharge', value: val }));
        } else {
            updateUI(localBmsState);
        }
    } else if (localBmsState.mode === 'webble') {
        writeBmsSetting(0x9E, val ? 1 : 0, 1);
    }
    showToast(`Saklar DCH: ${val ? 'ON' : 'OFF'}`, 'info');
});

switchBalance.addEventListener('change', () => {
    const val = switchBalance.checked;
    localBmsState.telemetry.switches.balance = val;
    
    if (localBmsState.mode === 'simulated') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_switch', switch: 'balance', value: val }));
        } else {
            updateUI(localBmsState);
        }
    } else if (localBmsState.mode === 'webble') {
        writeBmsSetting(0x9F, val ? 1 : 0, 1);
    }
    showToast(`Saklar BAL: ${val ? 'ON' : 'OFF'}`, 'info');
});

writeSettingsBtn.addEventListener('click', () => {
    if (!isSettingsDirty) {
        showToast('Tidak ada parameter yang berubah', 'info');
        return;
    }

    const payload = {
        cellCount: parseInt(document.getElementById('set-cell-count').value),
        nominalCapacity: parseFloat(document.getElementById('set-nominal-capacity').value),
        cellOvervoltageProtect: parseFloat(document.getElementById('set-cell-ov').value),
        cellUndervoltageProtect: parseFloat(document.getElementById('set-cell-uv').value),
        maxChargeCurrent: parseFloat(document.getElementById('set-max-charge').value),
        maxDischargeCurrent: parseFloat(document.getElementById('set-max-discharge').value),
        balanceStartVoltage: parseFloat(document.getElementById('set-balance-start').value),
        balanceTriggerDiff: parseFloat(document.getElementById('set-balance-diff').value),
        maxBalanceCurrent: parseFloat(document.getElementById('set-balance-current').value)
    };

    for (const [key, val] of Object.entries(payload)) {
        localBmsState.settings[key] = val;
    }

    if (localBmsState.mode === 'simulated') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            for (const [key, val] of Object.entries(payload)) {
                ws.send(JSON.stringify({ type: 'update_setting', name: key, value: val }));
            }
        } else {
            updateUI(localBmsState);
        }
    } else if (localBmsState.mode === 'webble') {
        writeBmsSetting(0x90, Math.round(payload.cellOvervoltageProtect * 1000), 2);
        writeBmsSetting(0x91, Math.round(payload.cellUndervoltageProtect * 1000), 2);
        writeBmsSetting(0x94, Math.round(payload.maxChargeCurrent * 10), 2);
        writeBmsSetting(0x95, Math.round(payload.maxDischargeCurrent * 10), 2);
        writeBmsSetting(0x96, Math.round(payload.balanceStartVoltage * 1000), 2);
        writeBmsSetting(0x97, Math.round(payload.balanceTriggerDiff * 1000), 2);
        writeBmsSetting(0x98, Math.round(payload.maxBalanceCurrent * 10), 2);
    }

    isSettingsDirty = false;
    settingsSync.className = "settings-sync-badge";
    settingsSync.innerHTML = `<i data-lucide="check-circle-2"></i> Sinkron`;
    showToast('Parameter terkirim ke BMS', 'success');
});

// Auto scale screen to fit parent frame/viewport without clipping
function autoScaleDashboard() {
    const bezel = document.querySelector('.outer-bezel');
    if (!bezel) return;
    
    bezel.style.transform = 'none';
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const bezelWidth = bezel.offsetWidth;
    const bezelHeight = bezel.offsetHeight;
    
    // Add 10px breathing room on all sides
    const scaleX = (viewportWidth - 20) / bezelWidth;
    const scaleY = (viewportHeight - 20) / bezelHeight;
    const scale = Math.min(scaleX, scaleY, 1);
    
    bezel.style.transform = `scale(${scale})`;
    bezel.style.transformOrigin = 'center center';
}

window.addEventListener('resize', autoScaleDashboard);
window.addEventListener('load', autoScaleDashboard);

// Start client handlers
updateUI(localBmsState);
connectWebSocket();
if (localBmsState.mode === 'webble') {
    // BLE Mode initial wait
} else if (localBmsState.mode === 'remote') {
    startRemotePolling();
} else {
    startLocalSimulator();
}
autoScaleDashboard();
