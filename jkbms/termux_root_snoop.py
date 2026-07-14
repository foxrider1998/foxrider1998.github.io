#!/usr/bin/env python3
import time
import os
import sys
import subprocess
import urllib.request
import json
import ssl

# ANSI escape codes for terminal coloring
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Global State: Menampung dan menggabungkan data dari frame yang berbeda
bms_state = {
    "cells": [],
    "totalVoltage": 0.0,
    "current": 0.0,
    "soc": 0,
    "temperatures": {"mosfet": 0.0, "temp1": 0.0, "temp2": 0.0},
    "switches": {"charge": True, "discharge": True, "balance": True},
    "last_updated": 0
}

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def read_uint32_be(data, offset):
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

def decode_legacy_55aa_payload(data):
    """
    Parser pintar untuk protokol JK04 (55 AA EB 90).
    Mendeteksi jenis frame (Cmd ID di byte ke-4) agar tidak salah kamar.
    """
    global bms_state
    
    if len(data) < 10:
        return False
        
    cmd_id = data[4] # Byte ke-4 menentukan jenis isi paket
    updated = False

    # FRAME TIPE 1: Khusus Data Sel Baterai (Cell Voltages)
    if cmd_id == 0x01 or (len(data) >= 40 and data[5] <= 24):
        cells_temp = []
        # Baca maksimal 12 sel (sesuai spesifikasi LiFePO4 Anda)
        for i in range(12):
            off = 8 + (i * 2)
            if off + 1 < len(data):
                mv = read_uint16_be(data, off)
                if 2000 <= mv <= 4300: # Sanity check LiFePO4
                    cells_temp.append({
                        "index": i + 1,
                        "voltage": round(mv / 1000.0, 3),
                        "balancing": False
                    })
        if len(cells_temp) >= 4: # Minimal ada 4 sel terbaca valid
            bms_state["cells"] = cells_temp
            updated = True

    # FRAME TIPE 2: Khusus Status Umum (Total V, Arus, SOC, Suhu)
    elif cmd_id == 0x02 or len(data) >= 80:
        # Cari angka sinkronisasi untuk Total Voltage (sekitar 38V = ~3800 cV)
        if 49 < len(data):
            vtg = read_uint16_be(data, 48) * 0.01
            if 30.0 <= vtg <= 45.0: # Filter ketat tegangan baterai 12S
                bms_state["totalVoltage"] = round(vtg, 2)
                updated = True
                
        if 53 < len(data):
            cur = read_int16_be(data, 52) * 0.01
            if -150.0 <= cur <= 150.0:
                bms_state["current"] = round(cur, 2)
                
        if 86 < len(data):
            soc_val = data[86]
            if 0 <= soc_val <= 100:
                bms_state["soc"] = soc_val
                
        if 77 < len(data):
            temp_c = read_int16_be(data, 76) * 0.1
            if -10.0 <= temp_c <= 85.0:
                bms_state["temperatures"]["mosfet"] = round(temp_c, 1)

    return updated

def upload_to_cloud(key="0d6013fe3fa362ab0388"):
    """
    Mengirim data ke npoint.io dengan bypass SSL Android Termux
    """
    global bms_state
    url = f"https://api.npoint.io/{key}"
    
    # Format JSON disesuaikan standar Webview Anda
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "device_info": {
            "vendor": "Jikong",
            "model": "JK-BMS-12S-PLTS",
            "connection": "Termux BLE Snoop Passthrough"
        },
        "realtime_status": {
            "battery_type": "LiFePO4",
            "state_of_charge_pct": bms_state["soc"],
            "is_charging": bms_state["current"] > 0,
            "is_discharging": bms_state["current"] < 0
        },
        "measurements": {
            "total_voltage_v": bms_state["totalVoltage"],
            "current_a": bms_state["current"],
            "power_w": round(bms_state["totalVoltage"] * bms_state["current"], 2),
            "temperature_mos_c": bms_state["temperatures"]["mosfet"]
        },
        "cell_data": {
            "cell_count": len(bms_state["cells"]),
            "voltages": bms_state["cells"]
        }
    }
    
    try:
        # Buat SSL Context yang mengabaikan error sertifikat di Android
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, indent=2).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Termux/JKBMS'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=4, context=ctx) as res:
            if res.status == 200:
                print(f"{GREEN} └─> [Cloud ✅] Sukses update JSON ke npoint.io!{RESET}")
            else:
                print(f"{YELLOW} └─> [Cloud ⚠️] Respon server: HTTP {res.status}{RESET}")
    except Exception as e:
        print(f"{RED} └─> [Cloud ❌] Gagal upload: {str(e)[:45]}{RESET}")

last_upload_time = 0

def render_ui():
    global bms_state, last_upload_time
    
    vtg = bms_state["totalVoltage"]
    curr = bms_state["current"]
    soc = bms_state["soc"]
    temp = bms_state["temperatures"]["mosfet"]
    cells = bms_state["cells"]
    
    # Hanya tampilkan jika data utama sudah tersinkronisasi
    if vtg == 0.0:
        return

    timestamp = time.strftime("%H:%M:%S")
    curr_color = GREEN if curr >= 0 else YELLOW
    
    # Format teks sel
    cell_v_str = ", ".join([f"C{c['index']}:{c['voltage']}V" for c in cells[:6]])
    if len(cells) > 6:
        cell_v_str += f" (+{len(cells)-6} sel)"

    print(f"[{timestamp}] {BOLD}V={vtg:.2f}V{RESET} | {curr_color}I={curr:+.2f}A{RESET} | {BLUE}SOC={soc}%{RESET} | Temp={temp}°C")
    if cells:
        print(f"           └─> Sel: {CYAN}{cell_v_str}{RESET}")
    
    # Trigger upload cloud setiap 4 detik
    now = time.time()
    if now - last_upload_time >= 4.0:
        last_upload_time = now
        upload_to_cloud()

def main():
    print(f"{GREEN}{BOLD}=== JKBMS Native PCAP Snoop Parser (v2.0 Fixed) ==={RESET}")
    print("Membaca stream /data/log/bt/btsnoop_hci.log dari sistem Android...")
    
    cmd = ["su", "-c", "tail -f -c +0 /data/log/bt/btsnoop_hci.log"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    header = proc.stdout.read(16)
    if len(header) < 16 or not header.startswith(b'btsnoop\0'):
        print(f"{RED}[Error] Format file btsnoop tidak valid atau izin Root ditolak.{RESET}")
        proc.terminate()
        sys.exit(1)
        
    print(f"{GREEN}Header terverifikasi. Menunggu sinkronisasi frame BMS...{RESET}\n")
    
    try:
        while True:
            rec_hdr = proc.stdout.read(24)
            if len(rec_hdr) < 24:
                time.sleep(0.02)
                continue
                
            incl_len = read_uint32_be(rec_hdr, 4)
            payload = proc.stdout.read(incl_len)
            if len(payload) < incl_len:
                continue
                
            # Filter ketat Header JKBMS Legacy (55 AA EB 90)
            idx_55aa = payload.find(b'\x55\xaa\xeb\x90')
            if idx_55aa != -1:
                clean_packet = payload[idx_55aa:]
                if len(clean_packet) >= 40:
                    # Parse dan update global state
                    if decode_legacy_55aa_payload(clean_packet):
                        render_ui()

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Monitoring dihentikan oleh pengguna.{RESET}")
        proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
