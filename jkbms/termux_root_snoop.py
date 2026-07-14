#!/usr/bin/env python3
import time
import os
import sys
import subprocess
import urllib.request
import json
import ssl

# Warna terminal
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Global State untuk menggabungkan potongan paket sel dan paket status
bms_state = {
    "cells": [],
    "totalVoltage": 0.0,
    "current": 0.0,
    "soc": 0,
    "temperatures": {"mosfet": 0.0, "temp1": 0.0, "temp2": 0.0},
    "last_updated": 0
}

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def parse_packet_chunk(data):
    """
    Membedah potongan byte dan memperbarui bms_state jika valid.
    Menggunakan offset biner yang tepat dari dump hex S20+:
    55 AA EB 90 -> Header
    - Voltase Sel (12S): offset 12 s/d 35 (2-byte BE per sel)
    - Total Voltage: offset 50-51 (0.01V)
    - Current/Arus: offset 54-55 (Signed BE, 0.01A)
    - MOSFET Temp: offset 82-83 (Signed BE, 0.1C)
    - SOC: offset 92 (1 byte)
    """
    global bms_state
    if len(data) < 100:
        return False
        
    updated = False

    # 1. Parsing Voltase 12 Sel (12 * 2 = 24 bytes) mulai dari offset 12
    # Contoh hex: 0c 21 0c a0 0c f2 0b a0... -> 3105 mV, 3232 mV, 3314 mV, 2976 mV
    cells_temp = []
    for i in range(12):
        off = 12 + (i * 2)
        if off + 1 < len(data):
            mv = read_uint16_be(data, off)
            if 2000 <= mv <= 4300: # Sanity check LiFePO4
                cells_temp.append({
                    "index": i + 1,
                    "voltage": round(mv / 1000.0, 3),
                    "balancing": False
                })
    if len(cells_temp) >= 4:
        bms_state["cells"] = cells_temp
        updated = True

    # 2. Parsing Total Pack Voltage (offset 50-51)
    if 51 < len(data):
        raw_vtg = read_uint16_be(data, 50)
        vtg = raw_vtg * 0.01
        if 30.0 <= vtg <= 45.0: # Range baterai 12S
            bms_state["totalVoltage"] = round(vtg, 2)
            updated = True

    # 3. Parsing Arus / Current (offset 54-55)
    if 55 < len(data):
        raw_cur = read_int16_be(data, 54)
        cur = raw_cur * 0.01
        if -150.0 <= cur <= 150.0:
            bms_state["current"] = round(cur, 2)

    # 4. Parsing Suhu MOSFET (offset 82-83)
    if 83 < len(data):
        raw_temp = read_int16_be(data, 82)
        temp_c = raw_temp * 0.1
        if -10.0 <= temp_c <= 85.0:
            bms_state["temperatures"]["mosfet"] = round(temp_c, 1)

    # 5. Parsing SOC (offset 92)
    # Contoh hex: 0x5e = 94% atau 0x43 = 67%
    if 92 < len(data):
        soc_val = data[92]
        if 0 <= soc_val <= 100:
            bms_state["soc"] = soc_val

    return updated


def harvest_latest_log():
    """
    Panen 8 KB terakhir dari log btsnoop (sangat ringan, tanpa streaming)
    """
    cmd = ["su", "-c", "tail -c 8192 /data/log/bt/btsnoop_hci.log"]
    try:
        # Sedot 8000 byte terakhir dari file log
        payload = subprocess.check_output(cmd, stderr=subprocess.DEVNULL)
        
        # Cari semua kemunculan header JKBMS Legacy (55 AA EB 90)
        idx = 0
        found_any = False
        while True:
            idx = payload.find(b'\x55\xaa\xeb\x90', idx)
            if idx == -1:
                break
            
            # Potong frame dan coba baca
            chunk = payload[idx:idx+120]
            if parse_packet_chunk(chunk):
                found_any = True
                
            idx += 4 # Geser ke pencarian berikutnya
            
        return found_any
    except Exception:
        return False

def upload_to_cloud(key="0d6013fe3fa362ab0388"):
    global bms_state
    url = f"https://api.npoint.io/{key}"
    
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "device_info": {
            "vendor": "Jikong",
            "model": "JK-BMS-12S-PLTS",
            "mode": "5-Second Harvest Mode"
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
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, indent=2).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 Termux/JKBMS-Harvester'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=4, context=ctx) as res:
            return res.status == 200
    except Exception:
        return False

def main():
    print(f"{GREEN}{BOLD}=== JKBMS 5-Second Harvester (Mode Hemat Daya) ==={RESET}")
    print("Skrip akan tidur 5 detik -> Panen Log -> Upload Cloud -> Tidur lagi...\n")
    
    try:
        while True:
            start_time = time.time()
            
            # 1. Panen data dari log
            has_data = harvest_latest_log()
            
            # 2. Jika dapat data valid, tampilkan dan upload
            if has_data and bms_state["totalVoltage"] > 0:
                vtg = bms_state["totalVoltage"]
                curr = bms_state["current"]
                soc = bms_state["soc"]
                temp = bms_state["temperatures"]["mosfet"]
                cells = bms_state["cells"]
                
                curr_color = GREEN if curr >= 0 else YELLOW
                cell_str = ", ".join([f"C{c['index']}:{c['voltage']}V" for c in cells[:4]])
                if len(cells) > 4: cell_str += f" (+{len(cells)-4} sel)"
                
                # Upload ke cloud
                cloud_ok = upload_to_cloud()
                cloud_icon = f"{GREEN}[Cloud ✅]{RESET}" if cloud_ok else f"{RED}[Cloud ❌]{RESET}"
                
                timestamp = time.strftime("%H:%M:%S")
                print(f"[{timestamp}] {cloud_icon} {BOLD}V={vtg:.2f}V{RESET} | {curr_color}I={curr:+.2f}A{RESET} | {BLUE}SOC={soc}%{RESET} | Temp={temp}°C")
                print(f"           └─> Sel: {CYAN}{cell_str}{RESET}")
            else:
                print(f"[{time.strftime('%H:%M:%S')}] {YELLOW}⏳ Menunggu paket baru dari aplikasi resmi...{RESET}")
                
            # 3. Hitung sisa waktu dan TIDUR PULAS selama 5 detik
            elapsed = time.time() - start_time
            sleep_time = max(0.5, 5.0 - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Harvester dihentikan oleh pengguna.{RESET}")
        sys.exit(0)

if __name__ == "__main__":
    main()
