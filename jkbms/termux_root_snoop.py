#!/usr/bin/env python3
import time
import os
import sys
import subprocess
import urllib.request
import json

# ANSI escape codes for coloring
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
BOLD = "\033[1m"
RESET = "\033[0m"

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def read_uint32_be(data, offset):
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

def decode_legacy_55aa_payload(data):
    # Struktur JKBMS Legacy 55 AA berdasarkan analisis dump btsnoop Samsung S20+ live:
    # 55 AA EB 90 (Header) -> disusul status bytes
    # Voltase Sel 1-16: berturut-turut bertipe 2-byte BE (mV) dimulai dari offset 8:
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {"charge": True, "discharge": True, "balance": True}
    }
    
    try:
        # Loop baca tegangan sel (16 sel max)
        for i in range(16):
            off = 8 + (i * 2)
            if off + 1 < len(data):
                mv = (data[off] << 8) | data[off+1]
                if mv > 2000 and mv < 4500:
                    t["cells"].append({
                        "index": i + 1,
                        "voltage": mv / 1000.0,
                        "balancing": False
                    })
        
        # MOSFET & Sensor Temperature: Terletak di offset 76-77
        if 77 < len(data):
            raw_temp = read_int16_be(data, 76)
            t["temperatures"]["mosfet"] = raw_temp * 0.1
            t["temperatures"]["temp1"] = raw_temp * 0.1
            t["temperatures"]["temp2"] = raw_temp * 0.1
            
        # Total Voltage (0.01V): Terletak di offset 48-49
        if 49 < len(data):
            t["totalVoltage"] = read_uint16_be(data, 48) * 0.01
            
        # Current (0.01A): Terletak di offset 52-53 (Signed)
        if 53 < len(data):
            t["current"] = read_int16_be(data, 52) * 0.01
            
        # SOC: Terletak di offset 86
        if 86 < len(data):
            t["soc"] = data[86]
        else:
            t["soc"] = 100 # default
            
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
            # Jika bit ke-15 aktif, artinya arus bernilai negatif (Discharging)
            if raw_cur & 0x8000:
                val = raw_cur & 0x7FFF
                t["current"] = -(val * 0.01)
            else:
                t["current"] = raw_cur * 0.01
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
            offset += 2

    if t["cells"]:
        t["cells"].sort(key=lambda x: x["index"])
    t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
    
    return t

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
    except Exception as e:
        pass

last_upload_time = 0

def render_ui(t):
    global last_upload_time
    
    vtg = t.get('totalVoltage', 0.0)
    curr = t.get('current', 0.0)
    soc = t.get('soc', 0)
    temp = t.get('temperatures', {}).get('mosfet', 0.0)
    
    cells = t.get('cells', [])
    cell_v_str = ", ".join([f"C{c['index']}:{c['voltage']:.3f}V" for c in cells[:8]])
    if len(cells) > 8:
        cell_v_str += "..."

    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] V={vtg:.2f}V | I={curr:+.2f}A | SOC={soc}% | Temp={temp:.1f}°C | {cell_v_str}")
    
    now = time.time()
    if now - last_upload_time >= 3.0:
        last_upload_time = now
        upload_to_cloud(t)

def main():
    print("Memulai sadap btsnoop log secara native (PCAP parser)...")
    
    # Membaca live log
    cmd = ["su", "-c", "tail -f -c +0 /data/log/bt/btsnoop_hci.log"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    # 1. Skip Btsnoop File Header (16 bytes)
    header = proc.stdout.read(16)
    if len(header) < 16 or not header.startswith(b'btsnoop\0'):
        print("[Error] Format file log btsnoop tidak valid.")
        proc.terminate()
        sys.exit(1)
        
    print("Header btsnoop terverifikasi. Menunggu paket data...")
    
    try:
        while True:
            # 2. Baca Record Header (24 bytes) per paket
            rec_hdr = proc.stdout.read(24)
            if len(rec_hdr) < 24:
                time.sleep(0.05)
                continue
                
            # Parse record length
            incl_len = read_uint32_be(rec_hdr, 4)
            
            # 3. Baca payload asli paket (incl_len bytes)
            payload = proc.stdout.read(incl_len)
            if len(payload) < incl_len:
                continue
                
            # Filter hanya data yang berisi JKBMS header: 4E 57 atau 55 AA
            is_legacy = False
            header_idx = -1
            
            idx_4e57 = payload.find(b'\x4e\x57')
            idx_55aa = payload.find(b'\x55\xaa')
            
            if idx_4e57 != -1:
                header_idx = idx_4e57
            elif idx_55aa != -1:
                header_idx = idx_55aa
                is_legacy = True
                
            if header_idx == -1:
                continue
                
            # Extract data paket JKBMS yang bersih dari enkapsulasi pcap
            clean_packet = payload[header_idx:]
            
            if is_legacy:
                if len(clean_packet) >= 120:
                    telemetry = decode_legacy_55aa_payload(clean_packet[:120])
                    if telemetry:
                        render_ui(telemetry)
            else:
                if len(clean_packet) >= 11:
                    packet_len = (clean_packet[2] << 8) | clean_packet[3]
                    if len(clean_packet) >= packet_len:
                        payload_data = clean_packet[:packet_len]
                        data_part = payload_data[:-4]
                        
                        rx_checksum = (payload_data[-4] << 24) | (payload_data[-3] << 16) | (payload_data[-2] << 8) | payload_data[-1]
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
