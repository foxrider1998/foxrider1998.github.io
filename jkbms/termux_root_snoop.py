#!/usr/bin/env python3
import time
import os
import sys
import subprocess

# ANSI escape codes for coloring
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
BOLD = "\033[1m"
RESET = "\033[0m"

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def draw_bar(percentage, length=20):
    filled = int(round(length * percentage / 100))
    bar = "█" * filled + "░" * (length - filled)
    return f"[{bar}] {percentage}%"

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def read_uint32_be(data, offset):
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

def read_int32_be(data, offset):
    val = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    return val - 4294967296 if val > 2147483647 else val

def parse_warning_flags(flags):
    warnings = []
    if flags & (1 << 0): warnings.append("Low Single Cell Voltage")
    if flags & (1 << 1): warnings.append("Overpack Voltage")
    if flags & (1 << 2): warnings.append("Underpack Voltage")
    if flags & (1 << 3): warnings.append("Overtemp")
    return warnings

def decode_legacy_55aa_payload(data):
    # Paket JKBMS Legacy 55 AA (panjang ~140 bytes)
    # Byte 0-1: 55 AA
    # Byte 4 s/d 35: Voltase Sel 1-16 (2 byte BE per sel, mV)
    # Byte 38-39: MOSFET Temp
    # Byte 40-41: T1 Temp
    # Byte 42-43: T2 Temp
    # Byte 44-45: Total Voltage (0.01V)
    # Byte 48-49: Current (Signed BE, 0.01A)
    # Byte 52: SOC
    # Byte 53-54: Cycle Count
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {"charge": True, "discharge": True, "balance": True}
    }
    
    try:
        # Loop baca tegangan sel (asumsi 16 sel max)
        for i in range(16):
            off = 4 + (i * 2)
            if off + 1 < len(data):
                mv = (data[off] << 8) | data[off+1]
                if mv > 2000 and mv < 4500:
                    t["cells"].append({
                        "index": i + 1,
                        "voltage": mv / 1000.0,
                        "balancing": False
                    })
        
        # MOSFET Temp & Temps
        if 39 < len(data):
            t["temperatures"]["mosfet"] = read_int16_be(data, 38) * 0.1
        if 41 < len(data):
            t["temperatures"]["temp1"] = read_int16_be(data, 40) * 0.1
        if 43 < len(data):
            t["temperatures"]["temp2"] = read_int16_be(data, 42) * 0.1
            
        # Total Voltage (0.01V)
        if 45 < len(data):
            t["totalVoltage"] = read_uint16_be(data, 44) * 0.01
            
        # Current (0.01A)
        if 49 < len(data):
            t["current"] = read_int16_be(data, 48) * 0.01
            
        # SOC
        if 52 < len(data):
            t["soc"] = data[52]
            
        # Cycle Count
        if 54 < len(data):
            t["cycleCount"] = read_uint16_be(data, 53)
            
        t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
        return t
    except Exception as e:
        return None

def decode_jk_bms_payload(data):
    cmd_type = data[8]
    if cmd_type != 0x06:
        return None

    offset = 11
    length = len(data)
    
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {}
    }
    s = {}

    while offset < length:
        tag = data[offset]
        offset += 1

        if tag == 0x79:
            len_val = data[offset]
            offset += 1
            cell_count = len_val // 3
            for i in range(cell_count):
                idx = data[offset + i*3]
                volt = (data[offset + i*3 + 1] << 8) | data[offset + i*3 + 2]
                t["cells"].append({
                    "index": idx,
                    "voltage": volt / 1000.0,
                    "balancing": False
                })
            offset += len_val
        elif tag == 0x80:
            t["temperatures"]["mosfet"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x81:
            t["temperatures"]["temp1"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x82:
            t["temperatures"]["temp2"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x83:
            t["totalVoltage"] = read_uint16_be(data, offset) * 0.01
            offset += 2
        elif tag == 0x84:
            raw_cur = read_uint16_be(data, offset)
            is_neg = (raw_cur & 0x8000) != 0
            val = raw_cur & 0x7FFF
            t["current"] = -(val * 0.01) if is_neg else (val * 0.01)
            offset += 2
        elif tag == 0x85:
            t["soc"] = data[offset]
            offset += 1
        elif tag == 0x86:
            status_flags = data[offset]
            t["switches"]["charge"] = (status_flags & 0x01) != 0
            t["switches"]["discharge"] = (status_flags & 0x02) != 0
            t["switches"]["balance"] = (status_flags & 0x04) != 0
            offset += 1
        elif tag == 0x8B:
            t["cycleCount"] = read_uint16_be(data, offset)
            offset += 2
        elif tag == 0x87:
            offset += 2
        else:
            # Skip unknown tags
            offset += 2

    # Derived calculations
    if t["cells"]:
        t["cells"].sort(key=lambda x: x["index"])
    t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
    
    return t

import urllib.request
import json

def upload_to_cloud(telemetry, key="0d6013fe3fa362ab0388"):
    url = f"https://api.npoint.io/{key}"
    payload = {
        "timestamp": int(time.time()),
        "mode": "remote",
        "connectionStatus": "connected",
        "connectedDevice": {
            "name": "Termux Root Snoop",
            "address": "Localhci"
        },
        "telemetry": telemetry
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            res.read()
            # print(f" {GREEN}•{RESET}", end="", flush=True) # visual dot indicator for upload
    except Exception as e:
        print(f"\n[Cloud Error] Upload gagal: {e}")

# Rate limiter untuk cloud upload (max 1x per 3 detik)
last_upload_time = 0

def render_ui(t):
    global last_upload_time
    
    # Cetak dalam format log stream biasa (tidak perlu clear screen agar tidak kedip-kedip)
    vtg = t.get('totalVoltage', 0.0)
    curr = t.get('current', 0.0)
    soc = t.get('soc', 0)
    temp = t.get('temperatures', {}).get('mosfet', 0.0)
    
    cells = t.get('cells', [])
    cell_v_str = ", ".join([f"C{c['index']}:{c['voltage']:.3f}V" for c in cells[:8]]) # 8 sel pertama
    if len(cells) > 8:
        cell_v_str += "..."

    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] V={vtg:.2f}V | I={curr:+.2f}A | SOC={soc}% | Temp={temp:.1f}°C | {cell_v_str}")
    
    # Upload ke cloud secara periodik
    now = time.time()
    if now - last_upload_time >= 3.0:
        last_upload_time = now
        upload_to_cloud(t)


def main():
    print("Memulai sadap bluetooth log...")
    
    # Perintah su untuk membaca file secara live (tail -f)
    cmd = ["su", "-c", "tail -f -c +0 /data/log/bt/btsnoop_hci.log"]
    
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    buffer = bytearray()
    
    try:
        while True:
            # Baca byte per byte dari output tail log secara non-blocking
            byte = proc.stdout.read(1)
            if not byte:
                time.sleep(0.01)
                continue
            
            buffer.extend(byte)
            
            # Cari marker awal JKBMS packet: 4E 57 (JK02) atau 55 AA (Legacy UART)
            header_idx_4e57 = buffer.find(b'\x4e\x57')
            header_idx_55aa = buffer.find(b'\x55\xaa')
            
            # Tentukan header mana yang muncul duluan
            header_idx = -1
            is_legacy_55aa = False
            
            if header_idx_4e57 != -1 and header_idx_55aa != -1:
                if header_idx_4e57 < header_idx_55aa:
                    header_idx = header_idx_4e57
                else:
                    header_idx = header_idx_55aa
                    is_legacy_55aa = True
            elif header_idx_4e57 != -1:
                header_idx = header_idx_4e57
            elif header_idx_55aa != -1:
                header_idx = header_idx_55aa
                is_legacy_55aa = True

            if header_idx == -1:
                if len(buffer) > 2000:
                    del buffer[:-100]
                continue
            
            # Geser kursor ke awal header
            if header_idx > 0:
                del buffer[:header_idx]
                
            if len(buffer) < 4:
                continue
            
            if is_legacy_55aa:
                # Format legacy 55 AA biasanya memiliki panjang tetap atau panjang tertulis di byte ke-2
                # Dari analisis log, format 55 AA memiliki panjang data paket ~140 bytes
                packet_len = 140 
            else:
                # Format standard 4E 57 (panjang tertulis di byte ke-2 dan ke-3)
                packet_len = (buffer[2] << 8) | buffer[3]
            
            if len(buffer) < packet_len:
                continue
                
            packet = buffer[:packet_len]
            del buffer[:packet_len]
            
            if is_legacy_55aa:
                # Untuk format 55 AA, kita extract nilai sel (voltase, suhu, dll) di offset statis:
                # Byte 4 s/d 35: Tegangan 16 Sel (2 byte BE per sel)
                # Byte 38-39: MOSFET Temp, T1 Temp, T2 Temp, dll.
                try:
                    telemetry = decode_legacy_55aa_payload(packet)
                    if telemetry:
                        render_ui(telemetry)
                except Exception as e:
                    pass
            else:
                # Parsing data standard 4E 57 jika checksum valid
                if packet_len > 8:
                    data_part = packet[:-4]
                    rx_checksum = (packet[-4] << 24) | (packet[-3] << 16) | (packet[-2] << 8) | packet[-1]
                    calculated_checksum = sum(data_part)
                    
                    if calculated_checksum == rx_checksum:
                        telemetry = decode_jk_bms_payload(data_part)
                        if telemetry:
                            render_ui(telemetry)


    except KeyboardInterrupt:
        print("\nMonitoring dihentikan.")
        proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
