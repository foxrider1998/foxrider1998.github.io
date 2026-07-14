#!/usr/bin/env python3
"""
JK-BD6A24S10P (24S Smart Active Balancer) Harvester
- Mengurai paket protokol baru JKBMS JK02 (Header 4E 57 00 13) berbasis TLV
- Menyimpan histori lokal dan sinkronisasi data 24-Sel ke npoint.io
- Proteksi SSL bypass untuk kestabilan upload Android Termux
"""
import time
import os
import sys
import subprocess
import urllib.request
import json
import ssl
import copy
from collections import deque

# ANSI escape codes untuk warna antarmuka terminal
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "jkbms_config_24s.json")

# Default Config khusus BD6A24S10P (24S)
DEFAULT_CONFIG = {
    "device": {
        "cell_count": 24,
        "total_capacity_ah": 280.0,
        "vendor": "Jikong",
        "model": "JK-BD6A24S10P"
    },
    "polling": {
        "interval_sec": 4.0,
        "btsnoop_log_path": "/data/log/bt/btsnoop_hci.log",
        "btsnoop_tail_bytes": 16384
    },
    "cloud": {
        "enabled": True,
        "npoint_key": "0d6013fe3fa362ab0388",
        "upload_timeout_sec": 5,
        "max_retries": 3,
        "retry_backoff_sec": 1.5,
        "history_points_in_payload": 20
    },
    "history": {
        "enabled": True,
        "local_file": "jkbms_history_24s.jsonl",
        "max_entries": 5000
    },
    "alerts": {
        "cell_delta_warn_v": 0.050,
        "cell_delta_critical_v": 0.100,
        "min_cell_v": 2.500,
        "max_cell_v": 3.650,
        "max_mosfet_temp_c": 75.0
    }
}

def deep_merge(base, override):
    result = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result

def load_config():
    if not os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump(DEFAULT_CONFIG, f, indent=2)
        except Exception:
            pass
        return copy.deepcopy(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, "r") as f:
            user_cfg = json.load(f)
        return deep_merge(DEFAULT_CONFIG, user_cfg)
    except Exception:
        return copy.deepcopy(DEFAULT_CONFIG)

CFG = load_config()
CELL_COUNT = int(CFG["device"]["cell_count"])
HISTORY_FILE_PATH = os.path.join(SCRIPT_DIR, CFG["history"]["local_file"])

pending_uploads = deque(maxlen=20)

# Global State telemetry BMS 24 Sel
bms_state = {
    "cells": [],
    "totalVoltage": 0.0,
    "current": 0.0,
    "power": 0.0,
    "soc": 0,
    "totalCapacity": CFG["device"]["total_capacity_ah"],
    "remainCapacity": 0.0,
    "cycleCount": 0,
    "temperatures": {"mosfet": 0.0, "temp1": 0.0, "temp2": 0.0},
    "switches": {"charge": True, "discharge": True, "balance": True},
    "stats": {"delta_v": 0.000, "avg_v": 0.000, "max_v": 0.000, "min_v": 0.000},
    "last_updated": 0
}

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def update_derived_metrics():
    global bms_state
    cells = bms_state["cells"]
    if cells:
        voltages = [c["voltage"] for c in cells]
        bms_state["stats"]["max_v"] = max(voltages)
        bms_state["stats"]["min_v"] = min(voltages)
        bms_state["stats"]["delta_v"] = round(max(voltages) - min(voltages), 3)
        bms_state["stats"]["avg_v"] = round(sum(voltages) / len(voltages), 3)

    bms_state["power"] = round(bms_state["totalVoltage"] * bms_state["current"], 1)
    bms_state["remainCapacity"] = round((bms_state["soc"] / 100.0) * bms_state["totalCapacity"], 1)

def parse_jk02_tlv(data):
    """Parser untuk Protokol Jikong Baru TLV format (4E 57 00 13)"""
    global bms_state
    if len(data) < 20: 
        return False
    
    # Header: 4E 57 00 13 -> data length tertulis di bytes[4..5]
    # Kita mulai parsing TLV dari offset 12
    offset = 12
    length = len(data) - 5
    updated = False
    cells_temp = []
    
    while offset < length - 1:
        tag = data[offset]
        tag_len = data[offset + 1]
        val_off = offset + 2
        
        if val_off + tag_len > len(data): 
            break
        
        if tag == 0x79: # Cell Voltages (Index, Volt-High, Volt-Low)
            cell_count = tag_len // 3
            for i in range(cell_count):
                idx = data[val_off + (i * 3)]
                mv = (data[val_off + (i * 3) + 1] << 8) | data[val_off + (i * 3) + 2]
                if 2000 <= mv <= 4500:
                    cells_temp.append({"index": idx, "voltage": round(mv / 1000.0, 3)})
            if len(cells_temp) >= 4:
                bms_state["cells"] = sorted(cells_temp, key=lambda x: x["index"])
                updated = True
        elif tag == 0x80: 
            bms_state["temperatures"]["mosfet"] = round(read_int16_be(data, val_off) * 0.1, 1)
            updated = True
        elif tag == 0x81: 
            bms_state["temperatures"]["temp1"] = round(read_int16_be(data, val_off) * 0.1, 1)
        elif tag == 0x82: 
            bms_state["temperatures"]["temp2"] = round(read_int16_be(data, val_off) * 0.1, 1)
        elif tag == 0x83: # Total Voltages 0.01V
            vtg = read_uint16_be(data, val_off) * 0.01
            if 10.0 <= vtg <= 105.0: 
                bms_state["totalVoltage"] = round(vtg, 2)
                updated = True
        elif tag == 0x84: # Current 0.01A Signed (MSB is charging/discharging direction)
            raw_cur = read_uint16_be(data, val_off)
            cur = -((raw_cur & 0x7FFF) * 0.01) if (raw_cur & 0x8000) else (raw_cur * 0.01)
            if -300.0 <= cur <= 300.0: 
                bms_state["current"] = round(cur, 2)
                updated = True
        elif tag == 0x85: # SOC %
            soc_val = data[val_off]
            if 0 <= soc_val <= 100: 
                bms_state["soc"] = soc_val
                updated = True
        elif tag == 0x86: # Alarm / Warning status flags
            pass
        elif tag == 0x8B: # Cycle Count
            bms_state["cycleCount"] = read_uint16_be(data, val_off)
        
        offset += (2 + tag_len)
        
    if updated: 
        update_derived_metrics()
    return updated

def harvest_latest_log():
    log_path = CFG["polling"]["btsnoop_log_path"]
    tail_bytes = int(CFG["polling"]["btsnoop_tail_bytes"])
    cmd = ["su", "-c", f"tail -c {tail_bytes} {log_path}"]
    try:
        payload = subprocess.check_output(cmd, stderr=subprocess.DEVNULL)
        found = False
        
        # Cari data ber-header 4E 57 00 13 (Protokol Jikong Modern)
        idx = 0
        while True:
            idx = payload.find(b'\x4e\x57\x00\x13', idx)
            if idx == -1: 
                break
            # Coba urai paket dynamic TLV (max payload size 320 bytes)
            if parse_jk02_tlv(payload[idx:idx+320]): 
                found = True
            idx += 4
            
        return found
    except Exception:
        return False

def build_payload():
    global bms_state
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    
    # Schema payload ter-standardisasi untuk app.js
    payload = {
        "mode": "remote",
        "connectionStatus": "connected",
        "connectedDevice": {
            "name": CFG["device"]["model"],
            "address": "LocalHCI"
        },
        "telemetry": {
            "cells": bms_state["cells"],
            "totalVoltage": bms_state["totalVoltage"],
            "current": bms_state["current"],
            "power": bms_state["power"],
            "soc": bms_state["soc"],
            "remainingCapacity": bms_state["remainCapacity"],
            "totalCapacity": bms_state["totalCapacity"],
            "cycleCount": bms_state["cycleCount"],
            "temperatures": {
                "mosfet": bms_state["temperatures"]["mosfet"],
                "temp1": bms_state["temperatures"]["temp1"],
                "temp2": bms_state["temperatures"]["temp2"]
            },
            "balancersActive": False,
            "balanceCurrent": 0.0,
            "warnings": [],
            "switches": {
                "charge": bms_state["switches"]["charge"],
                "discharge": bms_state["switches"]["discharge"],
                "balance": bms_state["switches"]["balance"]
            }
        },
        "settings": {
            "cellCount": CELL_COUNT,
            "nominalCapacity": bms_state["totalCapacity"],
            "cellOvervoltageProtect": 3.65,
            "cellUndervoltageProtect": 2.50,
            "cellOvervoltageRecovery": 3.55,
            "cellUndervoltageRecovery": 2.80,
            "maxChargeCurrent": 100.0,
            "maxDischargeCurrent": 150.0,
            "balanceStartVoltage": 3.20,
            "balanceTriggerDiff": 0.010,
            "maxBalanceCurrent": 6.0
        }
    }
    return payload

def upload_to_cloud(payload):
    if not CFG["cloud"]["enabled"]:
        return False
    key = CFG["cloud"]["npoint_key"]
    url = f"https://api.npoint.io/{key}"
    timeout = CFG["cloud"]["upload_timeout_sec"]
    max_retries = int(CFG["cloud"]["max_retries"])
    backoff = float(CFG["cloud"]["retry_backoff_sec"])
    
    data_bytes = json.dumps(payload, indent=2).encode('utf-8')
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    attempt = 0
    while attempt <= max_retries:
        try:
            req = urllib.request.Request(
                url, data=data_bytes,
                headers={'Content-Type': 'application/json', 'User-Agent': 'Termux-JKBMS'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
                return res.status == 200
        except Exception:
            pass
        attempt += 1
        if attempt <= max_retries:
            time.sleep(backoff * attempt)
    return False

def render_apk_clone_ui(cloud_status, alerts):
    os.system('clear' if os.name == 'posix' else 'cls')
    t = time.strftime("%H:%M:%S")
    
    vtg = bms_state["totalVoltage"]
    cur = bms_state["current"]
    pwr = bms_state["power"]
    soc = bms_state["soc"]
    cap_rem = bms_state["remainCapacity"]
    cap_tot = bms_state["totalCapacity"]
    
    cur_color = GREEN if cur >= 0 else YELLOW
    pwr_color = GREEN if pwr >= 0 else YELLOW
    
    print(f"{BOLD}{CYAN}=========================================================={RESET}")
    print(f"{BOLD} 🔋 JKBMS {CFG['device']['model']} MONITOR        [{t}] {RESET}")
    print(f"{BOLD}{CYAN}=========================================================={RESET}")
    print(f" ⚡ TEGANGAN TOTAL : {BOLD}{GREEN}{vtg:<6.2f} V{RESET} | 🔌 ARUS    : {BOLD}{cur_color}{cur:<+7.2f} A{RESET}")
    print(f" 💡 DAYA BATERAI   : {BOLD}{pwr_color}{pwr:<6.1f} W{RESET} | 📊 SOC     : {BOLD}{BLUE}{soc}%{RESET} ({cap_rem}/{cap_tot}Ah)")
    print(f"{CYAN}----------------------------------------------------------{RESET}")
    print(f" 🌡️  SUHU SENSOR    : MOS: {BOLD}{bms_state['temperatures']['mosfet']}°C{RESET} | T1: {bms_state['temperatures']['temp1']}°C | T2: {bms_state['temperatures']['temp2']}°C")
    print(f" ⚖️  BALANCE SEL    : Delta: {BOLD}{MAGENTA}{bms_state['stats']['delta_v']}V{RESET} | Rata-rata: {bms_state['stats']['avg_v']}V")
    print(f"{CYAN}----------------------------------------------------------{RESET}")
    print(f" 📦 {BOLD}DETAIL TEGANGAN {CELL_COUNT} SEL (LiFePO4):{RESET}")
    
    cells = bms_state["cells"]
    # Render Grid 3 Kolom
    rows = (CELL_COUNT + 2) // 3
    for row in range(rows):
        line_str = "  "
        for col in range(3):
            idx = row + (col * rows)
            if idx < len(cells):
                c = cells[idx]
                v_val = c['voltage']
                color = RESET
                if v_val == bms_state["stats"]["min_v"] and bms_state["stats"]["delta_v"] > 0.05: 
                    color = RED
                elif v_val == bms_state["stats"]["max_v"] and bms_state["stats"]["delta_v"] > 0.05: 
                    color = GREEN
                line_str += f"[{c['index']:02d}] {color}{v_val:.3f}V{RESET}    "
        print(line_str)
        
    print(f"{BOLD}{CYAN}=========================================================={RESET}")
    cloud_icon = f"{GREEN}[Cloud ✅] Terkirim ke npoint.io{RESET}" if cloud_status else f"{RED}[Cloud ❌] Gagal sinkronisasi{RESET}"
    print(f" └─> Status: {cloud_icon} (Siklus: {bms_state['cycleCount']}x)")
    
    if alerts:
        print(f"{CYAN}----------------------------------------------------------{RESET}")
        for level, msg in alerts:
            color = RED if level == "CRITICAL" else YELLOW
            print(f" {color}{BOLD}[{level}]{RESET} {color}{msg}{RESET}")

def main():
    print(f"{GREEN}{BOLD}=== JKBMS BD6A24S10P Harvester Memulai... ==={RESET}")
    print("Membaca log btsnoop secara berkala...")
    
    try:
        while True:
            start_t = time.time()
            has_data = harvest_latest_log()
            
            if has_data and bms_state["totalVoltage"] > 0:
                payload = build_payload()
                cloud_ok = upload_to_cloud(payload)
                
                # Simpan histori lokal JSONL
                if CFG["history"]["enabled"]:
                    with open(HISTORY_FILE_PATH, "a") as f:
                        f.write(json.dumps(payload) + "\n")
                
                alerts = []
                # Delta Check
                a = CFG["alerts"]
                dv = bms_state["stats"]["delta_v"]
                if dv >= a["cell_delta_critical_v"]:
                    alerts.append(("CRITICAL", f"Delta tegangan sel {dv}V >= batas kritis {a['cell_delta_critical_v']}V"))
                elif dv >= a["cell_delta_warn_v"]:
                    alerts.append(("WARN", f"Delta tegangan sel {dv}V >= batas peringatan {a['cell_delta_warn_v']}V"))
                
                render_apk_clone_ui(cloud_ok, alerts)
            else:
                print(f"[{time.strftime('%H:%M:%S')}] {YELLOW}⏳ Menunggu paket data TLV (4E57) dari model BD6A24S10P...{RESET}")
                
            elapsed = time.time() - start_t
            time.sleep(max(0.5, float(CFG["polling"]["interval_sec"]) - elapsed))
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Monitoring dihentikan.{RESET}")
        sys.exit(0)

if __name__ == "__main__":
    main()
